// Generates themed SVG cards for the profile README from the GitHub GraphQL API.
// No dependencies. Runs in GitHub Actions (Node 20+).
//
//   GH_TOKEN=... GH_USER=UtsavUpadhyay08 PINS="Cp_Algorithms,seed_bank" node scripts/cards.mjs
//   FIXTURE=sample.json node scripts/cards.mjs        # offline test with saved data

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";

const USER = process.env.GH_USER || "UtsavUpadhyay08";
const OUT = process.env.OUT_DIR || "assets/generated";
const PINS = (process.env.PINS || "").split(",").map((s) => s.trim()).filter(Boolean);

const C = {
  bg: "#0B0F14", panel: "#0F151C", line: "#1F2937", text: "#E6EDF3", muted: "#7D8590",
  green: "#00E58A", amber: "#F5B83D", red: "#FF5C7A", blue: "#58A6FF",
};
const SANS = "'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Ubuntu,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n));

// ---------------------------------------------------------------- data
const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        name description stargazerCount forkCount isArchived
        primaryLanguage { name color }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
      }
    }
    pullRequests { totalCount }
    issues { totalCount }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]) { totalCount }
    contributionsCollection {
      contributionYears
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

async function load() {
  if (process.env.FIXTURE) return JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  const user = json.data.user;
  // second query: one contributionsCollection per year, for all-time totals
  const years = user.contributionsCollection.contributionYears;
  const parts = years.map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }`).join("\n");
  const r2 = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
    body: JSON.stringify({ query: `query($login: String!) { user(login: $login) { ${parts} } }`, variables: { login: USER } }),
  });
  const j2 = await r2.json();
  if (!r2.ok || j2.errors) throw new Error("GitHub API error (years): " + JSON.stringify(j2.errors || j2));
  user.allYears = years.map((y) => ({ year: y, calendar: j2.data.user[`y${y}`].contributionCalendar }));
  return user;
}

function monthly(u) {
  // all-time contributions bucketed by month, oldest first, trimmed to the first active month
  const m = new Map();
  for (const { calendar } of u.allYears) for (const w of calendar.weeks) for (const d of w.contributionDays) {
    const k = d.date.slice(0, 7); m.set(k, (m.get(k) || 0) + d.contributionCount);
  }
  const keys = [...m.keys()].sort();
  const first = keys.findIndex((k) => m.get(k) > 0);
  const now = new Date().toISOString().slice(0, 7);
  return keys.slice(Math.max(0, first)).filter((k) => k <= now).map((k) => ({ month: k, n: m.get(k) }));
}

// ---------------------------------------------------------------- helpers
const frame = (w, h, inner, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">` +
  `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.bg}" stroke="${C.line}"/>${inner}</svg>`;
const title = (x, y, t) => `<text x="${x}" y="${y}" font-family="${SANS}" font-size="17" font-weight="700" fill="${C.green}">${esc(t)}</text>`;
const tag = (x, y, t) => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="11" fill="${C.amber}" letter-spacing="1">${esc(t)}</text>`;

function wrap(text, max, lines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [""];
  for (const w of words) {
    const cur = out[out.length - 1];
    if ((cur + " " + w).trim().length <= max) out[out.length - 1] = (cur + " " + w).trim();
    else if (out.length < lines) out.push(w);
    else { out[out.length - 1] = cur.replace(/\s*\S*$/, "") + "…"; return out; }
  }
  return out;
}

// ---------------------------------------------------------------- cards
function statsCard(u) {
  const repos = u.repositories.nodes;
  const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);
  const cc = u.contributionsCollection;
  const rows = [
    ["★", "Stars earned", stars],
    ["◆", "Commits (last 12 mo)", cc.totalCommitContributions + cc.restrictedContributionsCount],
    ["⇅", "Pull requests", u.pullRequests.totalCount],
    ["!", "Issues", u.issues.totalCount],
    ["▣", "Public repos", u.repositories.totalCount],
    ["◎", "Followers", u.followers.totalCount],
  ];
  const total = u.allYears.reduce((a, y) => a + y.calendar.totalContributions, 0);
  const since = Math.min(...u.allYears.map((y) => y.year));
  let s = tag(28, 34, "$ git log --stats") + title(28, 60, "GitHub activity");
  rows.forEach(([icon, label, val], i) => {
    const y = 92 + i * 22;
    s += `<text x="28" y="${y}" font-family="${MONO}" font-size="13" fill="${C.amber}">${icon}</text>`;
    s += `<text x="50" y="${y}" font-family="${SANS}" font-size="14" fill="${C.text}">${esc(label)}</text>`;
    s += `<text x="270" y="${y}" text-anchor="end" font-family="${MONO}" font-size="14" font-weight="700" fill="${C.text}">${fmt(val)}</text>`;
  });
  // ring: contributions in the last year
  const cx = 375, cy = 130, r = 52, circ = 2 * Math.PI * r;
  const frac = Math.min(1, total / 500);
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="9"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.green}" stroke-width="9" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - Math.max(frac, 0.04))).toFixed(1)}">` +
       `<animate attributeName="stroke-dashoffset" from="${circ.toFixed(1)}" to="${(circ * (1 - Math.max(frac, 0.04))).toFixed(1)}" dur="1.4s" fill="freeze"/></circle>`;
  s += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="${SANS}" font-size="26" font-weight="800" fill="${C.text}">${fmt(total)}</text>`;
  s += `<text x="${cx}" y="${cy + 24}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${C.muted}">since ${since}</text>`;
  return frame(470, 230, s, `GitHub stats: ${stars} stars, ${total} contributions since ${since}`);
}

function langCard(u) {
  const bytes = new Map();
  for (const r of u.repositories.nodes) {
    if (r.isArchived) continue;
    for (const e of r.languages.edges) {
      const k = e.node.name;
      const v = bytes.get(k) || { size: 0, color: e.node.color || C.muted };
      v.size += e.size; bytes.set(k, v);
    }
  }
  const skip = new Set(["HTML", "CSS", "SCSS", "Procfile", "Dockerfile", "Shell", "Batchfile"]);
  let langs = [...bytes.entries()].filter(([k]) => !skip.has(k)).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const sum = langs.reduce((a, [, v]) => a + v.size, 0) || 1;
  let s = tag(28, 34, "$ ls ./languages") + title(28, 60, "Most used languages");
  let x = 28; const bw = 414;
  s += `<clipPath id="lb"><rect x="28" y="78" width="${bw}" height="10" rx="5"/></clipPath><g clip-path="url(#lb)">`;
  for (const [, v] of langs) { const w = (bw * v.size) / sum; s += `<rect x="${x.toFixed(1)}" y="78" width="${(w + 0.5).toFixed(1)}" height="10" fill="${v.color}"/>`; x += w; }
  s += `</g>`;
  langs.forEach(([name, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 28 + col * 215, ly = 122 + row * 30;
    s += `<circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${v.color}"/>`;
    s += `<text x="${lx + 20}" y="${ly}" font-family="${SANS}" font-size="14" fill="${C.text}">${esc(name)}</text>`;
    s += `<text x="${lx + 195}" y="${ly}" text-anchor="end" font-family="${MONO}" font-size="13" fill="${C.muted}">${((100 * v.size) / sum).toFixed(1)}%</text>`;
  });
  return frame(470, 230, s, "Most used languages: " + langs.map(([n]) => n).join(", "));
}

function pinCard(repo) {
  const lines = wrap(repo.description || "No description yet.", 62);
  let s = `<path d="M24 28h14v14H24z" fill="none" stroke="${C.green}" stroke-width="2"/><path d="M27 33h8M27 37h5" stroke="${C.green}" stroke-width="1.5"/>`;
  s += `<text x="48" y="41" font-family="${SANS}" font-size="17" font-weight="700" fill="${C.green}">${esc(repo.name)}</text>`;
  lines.forEach((l, i) => { s += `<text x="24" y="${72 + i * 20}" font-family="${SANS}" font-size="13.5" fill="${C.text}" fill-opacity=".85">${esc(l)}</text>`; });
  let x = 24; const y = 128;
  if (repo.primaryLanguage) {
    s += `<circle cx="${x + 6}" cy="${y - 4}" r="6" fill="${repo.primaryLanguage.color || C.muted}"/>`;
    s += `<text x="${x + 18}" y="${y}" font-family="${SANS}" font-size="13" fill="${C.text}">${esc(repo.primaryLanguage.name)}</text>`;
    x += 30 + repo.primaryLanguage.name.length * 7.5;
  }
  s += `<text x="${x}" y="${y}" font-family="${SANS}" font-size="13" fill="${C.muted}"><tspan fill="${C.amber}">★</tspan> ${repo.stargazerCount}<tspan dx="18" fill="${C.amber}">⑂</tspan> ${repo.forkCount}</text>`;
  return frame(500, 150, s, `${repo.name}: ${repo.description || ""}`);
}

function activityCard(u) {
  const pts = monthly(u);
  const W = 1200, H = 320, L = 60, R = 40, T = 96, B = 50;
  const max = Math.max(4, ...pts.map((p) => p.n));
  const X = (i) => L + ((W - L - R) * i) / Math.max(1, pts.length - 1);
  const Y = (n) => T + (H - T - B) * (1 - n / max);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.n).toFixed(1)}`).join(" ");
  const total = pts.reduce((a, p) => a + p.n, 0);
  const since = pts.length ? pts[0].month.slice(0, 4) : "";
  let s = `<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.green}" stop-opacity=".35"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></linearGradient>` +
          `<pattern id="gr" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#141B24"/></pattern></defs>`;
  s += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="url(#gr)"/>`;
  s += tag(L, 34, `$ git log --since=${since} --monthly`) + title(L, 56, "Contribution tape");
  s += `<text x="${W - R}" y="56" text-anchor="end" font-family="${MONO}" font-size="14" font-weight="700" fill="${C.green}">${fmt(total)} contributions since ${since}</text>`;
  for (let g = 0; g <= 3; g++) {
    const yy = T + ((H - T - B) * g) / 3, v = Math.round(max * (1 - g / 3));
    s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="#18212C" stroke-dasharray="3 5"/>`;
    s += `<text x="${L - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.muted}">${v}</text>`;
  }
  // x labels: every January, plus "Jul" when the range is short
  pts.forEach((p, i) => {
    const [y, mo] = p.month.split("-");
    const lab = mo === "01" ? y : (pts.length <= 30 && mo === "07" ? "Jul" : "");
    if (lab) s += `<text x="${X(i).toFixed(1)}" y="${H - B + 22}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${mo === "01" ? C.text : C.muted}">${lab}</text>` +
                  (mo === "01" ? `<line x1="${X(i).toFixed(1)}" y1="${T}" x2="${X(i).toFixed(1)}" y2="${H - B}" stroke="#1C2530"/>` : "");
  });
  s += `<path d="${line} L${X(pts.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z" fill="url(#ar)"/>`;
  s += `<path d="${line}" fill="none" stroke="${C.green}" stroke-width="2.2" stroke-linejoin="round" stroke-dasharray="6000" stroke-dashoffset="0"><animate attributeName="stroke-dashoffset" from="6000" to="0" dur="2.2s" fill="freeze"/></path>`;
  if (pts.length) {
    const peak = pts.reduce((b, p, i) => (p.n > pts[b].n ? i : b), 0);
    const px = X(peak), anchor = px > W - 140 ? "end" : px < L + 80 ? "start" : "middle";
    const label = new Date(pts[peak].month + "-01T00:00:00Z").toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
    s += `<circle cx="${px.toFixed(1)}" cy="${Y(pts[peak].n).toFixed(1)}" r="4.5" fill="${C.amber}"/>`;
    s += `<text x="${(anchor === "end" ? px + 4 : anchor === "start" ? px - 4 : px).toFixed(1)}" y="${(Y(pts[peak].n) - 12).toFixed(1)}" text-anchor="${anchor}" font-family="${MONO}" font-size="11" fill="${C.amber}">peak ${pts[peak].n} · ${label}</text>`;
    const li = pts.length - 1;
    s += `<circle cx="${X(li).toFixed(1)}" cy="${Y(pts[li].n).toFixed(1)}" r="4" fill="${C.green}"/>`;
  }
  return frame(W, H, s, `Contribution graph: ${total} contributions since ${since}`);
}

// ---------------------------------------------------------------- main
const u = await load();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, statsCard(u));
writeFileSync(`${OUT}/languages.svg`, langCard(u));
writeFileSync(`${OUT}/activity.svg`, activityCard(u));
for (const name of PINS) {
  const repo = u.repositories.nodes.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!repo) { console.warn(`! repo not found: ${name}`); continue; }
  writeFileSync(`${OUT}/pin-${repo.name.toLowerCase()}.svg`, pinCard(repo));
}
console.log(`cards written to ${OUT}/`);
