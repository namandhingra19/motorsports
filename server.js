/*
 * Research Workspace — standalone server.
 * Node 18+. No dependencies, no build step.
 *   node server.js        -> http://localhost:3000
 *
 * All data lives in ./data/workspace.json (override with DATA_DIR).
 * Every write goes through applyOp() below, so permissions and validation
 * are enforced on the server, not in the browser.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "workspace.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_DAYS = 30;

/* ----------------------------- persistence ----------------------------- */
let db = null;
let saveTimer = null;

function uid(p) { return p + "_" + crypto.randomBytes(6).toString("hex"); }
function nowISO() { return new Date().toISOString(); }
function ymd(d) { return new Date(d).toISOString().slice(0, 10); }

function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), s, 32).toString("hex");
  return s + ":" + h;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex"));
}


function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return ymd(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function seed() {
  const start = mondayOf(new Date());
  const end = addDays(start, 6);
  const members = [
    { id: "u_admin", name: "Admin", role: "ADMIN", password: hashPassword("admin123"), createdAt: nowISO() },
    { id: "u_m2", name: "Member 2", role: "MEMBER", password: hashPassword("member123"), createdAt: nowISO() },
    { id: "u_m3", name: "Member 3", role: "MEMBER", password: hashPassword("member123"), createdAt: nowISO() },
    { id: "u_m4", name: "Member 4", role: "MEMBER", password: hashPassword("member123"), createdAt: nowISO() },
  ];
  const week = {
    id: "w_01", number: 1, topic: "Electric Motors",
    objective: "Understand the motor industry, technology landscape, market gaps and potential startup opportunities.",
    start, end, status: "ACTIVE", checklist: {}, summary: {}, closedAt: null, createdAt: nowISO(),
  };
  const B = (id, parentId, name, extra) => Object.assign({
    id, weekId: "w_01", parentId, name, description: "", why: "", status: "ACTIVE",
    assignees: [], isIdea: false, createdBy: "u_admin", createdAt: nowISO(),
  }, extra || {});
  const branches = [
    B("b_market", null, "Industry & Market", { description: "Size, growth, segments and who actually buys motors." }),
    B("b_global", "b_market", "Global market"),
    B("b_india", "b_market", "Indian market"),
    B("b_oem", "b_market", "Manufacturers & OEMs"),
    B("b_eco", null, "Indian Ecosystem", { description: "Local players, policy, PLI schemes, import dependence." }),
    B("b_tech", null, "Motor Technology", { description: "Architectures, where each wins, and where the hard problems are." }),
    B("b_pmsm", "b_tech", "PMSM"),
    B("b_bldc", "b_tech", "BLDC"),
    B("b_ind", "b_tech", "Induction"),
    B("b_srm", "b_tech", "SRM"),
    B("b_axial", "b_tech", "Axial Flux", { description: "High torque density, compact packaging, hard to manufacture." }),
    B("b_app", null, "Applications", { description: "EV traction, industrial drives, HVAC, pumps, drones, robotics." }),
    B("b_mfg", null, "Manufacturing", { description: "Materials, winding, rotor, automation, testing." }),
    B("b_supply", null, "Supply Chain", { description: "Magnets, copper, laminations, controllers, lead times." }),
    B("b_gaps", null, "Market Gaps", { description: "Where the pain is loud and nobody is serving it well." }),
    B("b_robot", "b_tech", "Robotic Actuators", {
      isIdea: true, status: "EXPLORING", createdBy: "u_m3",
      why: "Imported actuators are expensive and robotics demand is increasing. Feels like a bigger wedge than motors alone.",
      description: "Integrated motor + gearbox + encoder + driver units for robot joints.",
    }),
  ];
  const T = (id, branchId, name, assignee, status, priority, dayOffset, description) => ({
    id, weekId: "w_01", branchId, name, description: description || "", assignee, status, priority,
    deadline: addDays(start, dayOffset), createdBy: "u_admin", createdAt: nowISO(), updatedAt: nowISO(),
  });
  const tasks = [
    T("t1", "b_pmsm", "Compare PMSM and BLDC on efficiency, torque density, cost and manufacturability", "u_m2", "IN PROGRESS", "HIGH", 3),
    T("t2", "b_india", "Size the Indian motor market by segment and estimate import share", "u_m3", "IN PROGRESS", "CRITICAL", 4),
    T("t3", "b_axial", "Map axial flux companies worldwide and what they actually ship", "u_m4", "TODO", "MEDIUM", 5),
    T("t4", "b_mfg", "Find out what winding automation costs at 10k units a year", "u_m2", "TODO", "MEDIUM", 5),
    T("t5", "b_supply", "Trace the magnet supply chain and price volatility over five years", "u_m4", "BLOCKED", "HIGH", 4, "Blocked: no reliable price series without a paid subscription."),
    T("t6", "b_gaps", "Interview three motor buyers about their single biggest complaint", "u_m3", "TODO", "CRITICAL", 6),
    T("t7", "b_global", "Summarise global market size, growth rate and main segments", "u_admin", "COMPLETED", "MEDIUM", 2),
    T("t8", "b_robot", "Price five imported actuator units and work out the landed cost", "u_m3", "IN PROGRESS", "HIGH", 6),
  ];
  const resources = [
    { id: "r1", weekId: "w_01", branchId: "b_global", url: "https://example.com/motor-market-report", title: "Global electric motor market outlook", description: "Segment split and growth rates by application.", type: "REPORT", tags: ["market", "global"], addedBy: "u_admin", createdAt: nowISO() },
    { id: "r2", weekId: "w_01", branchId: "b_axial", url: "https://example.com/axial-flux-review", title: "Axial flux machines: a review of topologies", description: "Torque density compared against radial flux.", type: "PAPER", tags: ["axial flux", "power density"], addedBy: "u_m4", createdAt: nowISO() },
    { id: "r3", weekId: "w_01", branchId: "b_robot", url: "https://example.com/actuator-price-list", title: "Integrated robot joint price list", description: "List prices for off-the-shelf actuator modules.", type: "PRODUCT", tags: ["actuators", "pricing"], addedBy: "u_m3", createdAt: nowISO() },
  ];
  const findings = [
    { id: "f1", weekId: "w_01", branchId: "b_axial", title: "Axial flux has a power-density advantage", text: "Axial flux architecture can provide high torque density and compact packaging, but manufacturing complexity remains a major barrier. Nobody in India appears to produce them at volume.", confidence: "MEDIUM", tags: ["power density", "manufacturing", "axial flux"], sources: ["r2"], author: "u_m4", createdAt: nowISO() },
    { id: "f2", weekId: "w_01", branchId: "b_india", title: "Import dependence sits in magnets, not finished motors", text: "Finished motors are largely made locally, but high-grade permanent magnets are almost entirely imported. That is where both the margin and the risk sit.", confidence: "HIGH", tags: ["imports", "magnets", "india"], sources: [], author: "u_m3", createdAt: nowISO() },
    { id: "f3", weekId: "w_01", branchId: "b_robot", title: "Imported robot joints carry a large markup", text: "List prices for integrated actuator modules are several times the bill of materials once landed cost and distributor margin are added.", confidence: "LOW", tags: ["actuators", "pricing"], sources: ["r3"], author: "u_m3", createdAt: nowISO() },
  ];
  const notes = [
    { id: "n1", weekId: "w_01", branchId: "b_tech", kind: "NOTE", text: "Keep the comparison to four axes only: efficiency, torque density, cost, manufacturability. Anything more and we will not finish.", tags: ["method"], author: "u_admin", createdAt: nowISO(), resolved: false },
    { id: "n2", weekId: "w_01", branchId: "b_gaps", kind: "QUESTION", text: "Do buyers actually pay for efficiency, or do they only look at upfront price?", tags: ["validation"], author: "u_m2", createdAt: nowISO(), resolved: false },
    { id: "n3", weekId: "w_01", branchId: "b_robot", kind: "QUESTION", text: "Is the real bottleneck the motor, the gearbox, or the control electronics?", tags: ["actuators"], author: "u_m3", createdAt: nowISO(), resolved: false },
  ];
  const comments = [
    { id: "c1", targetType: "task", targetId: "t2", author: "u_m2", text: "I think this price estimate is too high — check whether it includes the controller.", createdAt: nowISO() },
    { id: "c2", targetType: "task", targetId: "t2", author: "u_m3", text: "Found another supplier, updated source attached.", createdAt: nowISO() },
  ];
  return {
    version: 1, updatedAt: nowISO(), members, weeks: [week], branches, tasks,
    findings, resources, notes, comments, opportunities: [], decisions: [], meeting: [],
    sessions: {},
  };
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      for (const k of ["members", "weeks", "branches", "tasks", "findings", "resources", "notes", "comments", "opportunities", "decisions", "meeting"]) {
        if (!Array.isArray(db[k])) db[k] = [];
      }
      if (!db.sessions) db.sessions = {};
      return;
    } catch (e) {
      const backup = DATA_FILE + ".broken-" + Date.now();
      fs.copyFileSync(DATA_FILE, backup);
      console.error("workspace.json could not be read. A copy was kept at " + backup + ". Starting fresh.");
    }
  }
  db = seed();
  writeNow();
  console.log("Created a new workspace with four accounts.");
  console.log("  Admin     password: admin123");
  console.log("  Member 2  password: member123");
  console.log("  Member 3  password: member123");
  console.log("  Member 4  password: member123");
  console.log("Change these from the Team screen after the first sign-in.");
}

function writeNow() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function save() {
  db.updatedAt = nowISO();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { writeNow(); } catch (e) { console.error("Save failed:", e.message); } }, 150);
}

/* -------------------------------- auth -------------------------------- */
function pruneSessions() {
  const cutoff = Date.now() - SESSION_DAYS * 86400000;
  for (const [sid, s] of Object.entries(db.sessions)) {
    if (new Date(s.createdAt).getTime() < cutoff || !db.members.find((m) => m.id === s.userId)) delete db.sessions[sid];
  }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid || !db.sessions[sid]) return null;
  return db.members.find((m) => m.id === db.sessions[sid].userId) || null;
}
const publicUser = (m) => ({ id: m.id, name: m.name, role: m.role });

/* ------------------------------ helpers ------------------------------ */
const find = (arr, id) => arr.find((x) => x.id === id);
function descendantIds(branchId) {
  const out = [branchId];
  const walk = (id) => db.branches.filter((b) => b.parentId === id).forEach((c) => { out.push(c.id); walk(c.id); });
  walk(branchId);
  return out;
}
function weekOf(id) { return find(db.weeks, id); }
function assertOpenWeek(weekId) {
  const w = weekOf(weekId);
  if (!w) throw new HttpError(400, "That week no longer exists.");
  if (w.status !== "ACTIVE") throw new HttpError(403, "That week is archived, so it cannot be edited.");
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const str = (v, max) => String(v == null ? "" : v).slice(0, max || 4000);
const tagList = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

const STATUS = ["TODO", "IN PROGRESS", "BLOCKED", "REVIEW", "COMPLETED"];
const PRIORITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];
const RES_TYPES = ["ARTICLE", "PAPER", "COMPANY", "PATENT", "VIDEO", "REPORT", "PRODUCT", "NEWS", "OTHER"];
const OPP_STATUS = ["EXPLORING", "VALIDATING", "PROMISING", "SHORTLISTED", "REJECTED"];
const BRANCH_STATUS = ["ACTIVE", "EXPLORING", "PARKED", "DONE"];
const VERDICTS = ["", "KEEP", "INVESTIGATE", "REJECT", "DECISION NEEDED"];
const OPP_KEYS = ["problem", "customer", "existing", "market", "pain", "wtp", "tech", "competition", "whyNow", "whyUs", "moat", "mvpCost", "regulatory", "scalability", "openQs"];
const SUMMARY_KEYS = ["learned", "gaps", "tech", "opportunities", "strongest", "why", "risks", "validation", "next"];

/* ------------------------------- writes ------------------------------- */
function applyOp(user, type, p) {
  const isAdmin = user.role === "ADMIN";
  const admin = () => { if (!isAdmin) throw new HttpError(403, "Only an admin can do that."); };
  const owner = (authorId) => { if (!isAdmin && authorId !== user.id) throw new HttpError(403, "You can only change your own entries."); };

  switch (type) {
    /* ---- weeks ---- */
    case "week.create": {
      admin();
      const number = Math.max(0, ...db.weeks.map((w) => w.number)) + 1;
      db.weeks.forEach((w) => { if (w.status === "ACTIVE") { w.status = "ARCHIVED"; w.closedAt = w.closedAt || nowISO(); } });
      const w = {
        id: uid("w"), number, topic: str(p.topic, 120) || "Untitled topic", objective: str(p.objective, 1000),
        start: str(p.start, 10) || mondayOf(new Date()), end: str(p.end, 10) || addDays(mondayOf(new Date()), 6),
        status: "ACTIVE", checklist: {}, summary: {}, closedAt: null, createdAt: nowISO(),
      };
      db.weeks.push(w);
      return w.id;
    }
    case "week.update": {
      admin(); assertOpenWeek(p.id);
      const w = weekOf(p.id);
      if (p.topic !== undefined) w.topic = str(p.topic, 120);
      if (p.objective !== undefined) w.objective = str(p.objective, 1000);
      if (p.start) w.start = str(p.start, 10);
      if (p.end) w.end = str(p.end, 10);
      return w.id;
    }
    case "week.summary": {
      admin(); const w = weekOf(p.id);
      if (!w) throw new HttpError(400, "Unknown week.");
      w.summary = w.summary || {};
      SUMMARY_KEYS.forEach((k) => { if (p.summary && p.summary[k] !== undefined) w.summary[k] = str(p.summary[k], 4000); });
      return w.id;
    }
    case "week.reopen": {
      admin();
      const w = weekOf(p.id);
      if (!w) throw new HttpError(400, "Unknown week.");
      db.weeks.forEach((x) => { if (x.status === "ACTIVE") { x.status = "ARCHIVED"; x.closedAt = x.closedAt || nowISO(); } });
      w.status = "ACTIVE";
      w.closedAt = null;
      return w.id;
    }
    case "week.close": {
      admin(); const w = weekOf(p.id);
      if (!w) throw new HttpError(400, "Unknown week.");
      w.checklist = p.checklist || {};
      w.status = "ARCHIVED";
      w.closedAt = nowISO();
      return w.id;
    }

    /* ---- branches ---- */
    case "branch.create": {
      assertOpenWeek(p.weekId);
      const b = {
        id: uid("b"), weekId: p.weekId, parentId: p.parentId || null, name: str(p.name, 120),
        description: str(p.description, 2000), why: str(p.why, 2000),
        status: oneOf(p.status, BRANCH_STATUS, "ACTIVE"), assignees: (p.assignees || []).slice(0, 20),
        isIdea: !!p.isIdea, createdBy: user.id, createdAt: nowISO(),
      };
      if (!b.name) throw new HttpError(400, "A branch needs a name.");
      db.branches.push(b);
      return b.id;
    }
    case "branch.update": {
      const b = find(db.branches, p.id);
      if (!b) throw new HttpError(400, "Unknown branch.");
      assertOpenWeek(b.weekId);
      if (!isAdmin && b.createdBy !== user.id) throw new HttpError(403, "Only an admin or the person who created this branch can edit it.");
      if (p.name !== undefined) b.name = str(p.name, 120) || b.name;
      if (p.description !== undefined) b.description = str(p.description, 2000);
      if (p.why !== undefined) b.why = str(p.why, 2000);
      if (p.status !== undefined) b.status = oneOf(p.status, BRANCH_STATUS, b.status);
      if (p.assignees !== undefined) b.assignees = (p.assignees || []).slice(0, 20);
      if (p.parentId !== undefined) {
        const target = p.parentId || null;
        if (target && descendantIds(b.id).includes(target)) throw new HttpError(400, "A branch cannot be moved inside itself.");
        b.parentId = target;
      }
      return b.id;
    }
    case "branch.delete": {
      admin();
      const b = find(db.branches, p.id);
      if (!b) return null;
      assertOpenWeek(b.weekId);
      const ids = descendantIds(b.id);
      db.branches = db.branches.filter((x) => !ids.includes(x.id));
      db.tasks = db.tasks.filter((x) => !ids.includes(x.branchId));
      db.findings = db.findings.filter((x) => !ids.includes(x.branchId));
      db.resources = db.resources.filter((x) => !ids.includes(x.branchId));
      db.notes = db.notes.filter((x) => !ids.includes(x.branchId));
      db.opportunities = db.opportunities.filter((x) => !ids.includes(x.branchId));
      return null;
    }

    /* ---- tasks ---- */
    case "task.create": {
      admin();
      const b = find(db.branches, p.branchId);
      if (!b) throw new HttpError(400, "Pick a branch for this task.");
      assertOpenWeek(b.weekId);
      const t = {
        id: uid("t"), weekId: b.weekId, branchId: b.id, name: str(p.name, 300), description: str(p.description, 4000),
        assignee: p.assignee || "", status: oneOf(p.status, STATUS, "TODO"), priority: oneOf(p.priority, PRIORITY, "MEDIUM"),
        deadline: str(p.deadline, 10), createdBy: user.id, createdAt: nowISO(), updatedAt: nowISO(),
      };
      if (!t.name) throw new HttpError(400, "A task needs a description of what to do.");
      db.tasks.push(t);
      return t.id;
    }
    case "task.update": {
      const t = find(db.tasks, p.id);
      if (!t) throw new HttpError(400, "Unknown task.");
      assertOpenWeek(t.weekId);
      const mine = t.assignee === user.id;
      if (!isAdmin && !mine) throw new HttpError(403, "You can only change tasks assigned to you.");
      if (p.status !== undefined) t.status = oneOf(p.status, STATUS, t.status);
      if (isAdmin) {
        if (p.name !== undefined) t.name = str(p.name, 300) || t.name;
        if (p.assignee !== undefined) t.assignee = p.assignee || "";
        if (p.priority !== undefined) t.priority = oneOf(p.priority, PRIORITY, t.priority);
        if (p.deadline !== undefined) t.deadline = str(p.deadline, 10);
      }
      if (p.description !== undefined) t.description = str(p.description, 4000);
      t.updatedAt = nowISO();
      return t.id;
    }
    case "task.delete": {
      admin();
      const t = find(db.tasks, p.id);
      if (t) assertOpenWeek(t.weekId);
      db.tasks = db.tasks.filter((x) => x.id !== p.id);
      db.comments = db.comments.filter((c) => !(c.targetType === "task" && c.targetId === p.id));
      return null;
    }

    /* ---- findings ---- */
    case "finding.create": {
      const b = find(db.branches, p.branchId);
      if (!b) throw new HttpError(400, "Unknown branch.");
      assertOpenWeek(b.weekId);
      const f = {
        id: uid("f"), weekId: b.weekId, branchId: b.id, title: str(p.title, 200), text: str(p.text, 8000),
        confidence: oneOf(p.confidence, CONFIDENCE, "MEDIUM"), tags: tagList(p.tags),
        sources: (p.sources || []).slice(0, 20), author: user.id, createdAt: nowISO(),
      };
      if (!f.title) throw new HttpError(400, "A finding needs a title.");
      db.findings.push(f);
      return f.id;
    }
    case "finding.delete": {
      const f = find(db.findings, p.id);
      if (!f) return null;
      assertOpenWeek(f.weekId); owner(f.author);
      db.findings = db.findings.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- resources ---- */
    case "resource.create": {
      const b = find(db.branches, p.branchId);
      if (!b) throw new HttpError(400, "Unknown branch.");
      assertOpenWeek(b.weekId);
      const r = {
        id: uid("r"), weekId: b.weekId, branchId: b.id, url: str(p.url, 2000), title: str(p.title, 300),
        description: str(p.description, 2000), type: oneOf(p.type, RES_TYPES, "OTHER"),
        tags: tagList(p.tags), addedBy: user.id, createdAt: nowISO(),
      };
      if (!r.title) throw new HttpError(400, "A source needs a title.");
      db.resources.push(r);
      return r.id;
    }
    case "resource.delete": {
      const r = find(db.resources, p.id);
      if (!r) return null;
      assertOpenWeek(r.weekId); owner(r.addedBy);
      db.resources = db.resources.filter((x) => x.id !== p.id);
      db.findings.forEach((f) => { f.sources = (f.sources || []).filter((s) => s !== p.id); });
      return null;
    }

    /* ---- notes and questions ---- */
    case "note.create": {
      const b = find(db.branches, p.branchId);
      if (!b) throw new HttpError(400, "Unknown branch.");
      assertOpenWeek(b.weekId);
      const n = {
        id: uid("n"), weekId: b.weekId, branchId: b.id, kind: oneOf(p.kind, ["NOTE", "MEETING", "QUESTION"], "NOTE"),
        text: str(p.text, 8000), tags: tagList(p.tags), author: user.id, createdAt: nowISO(), resolved: false,
      };
      if (!n.text) throw new HttpError(400, "Write something first.");
      db.notes.push(n);
      return n.id;
    }
    case "note.resolve": {
      const n = find(db.notes, p.id);
      if (!n) return null;
      assertOpenWeek(n.weekId);
      n.resolved = !!p.resolved;
      return n.id;
    }
    case "note.delete": {
      const n = find(db.notes, p.id);
      if (!n) return null;
      assertOpenWeek(n.weekId); owner(n.author);
      db.notes = db.notes.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- comments ---- */
    case "comment.create": {
      const c = {
        id: uid("c"), targetType: oneOf(p.targetType, ["task", "branch", "opportunity", "finding"], "branch"),
        targetId: str(p.targetId, 60), text: str(p.text, 4000), author: user.id, createdAt: nowISO(),
      };
      if (!c.text) throw new HttpError(400, "Write something first.");
      db.comments.push(c);
      return c.id;
    }
    case "comment.delete": {
      const c = find(db.comments, p.id);
      if (!c) return null;
      owner(c.author);
      db.comments = db.comments.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- opportunities ---- */
    case "opportunity.save": {
      const b = find(db.branches, p.branchId);
      if (!b) throw new HttpError(400, "Unknown branch.");
      assertOpenWeek(b.weekId);
      let o = db.opportunities.find((x) => x.branchId === b.id);
      if (!o) {
        o = { id: uid("o"), weekId: b.weekId, branchId: b.id, createdBy: user.id, createdAt: nowISO() };
        db.opportunities.push(o);
      }
      o.title = str(p.title, 200) || b.name;
      o.status = oneOf(p.status, OPP_STATUS, o.status || "EXPLORING");
      OPP_KEYS.forEach((k) => { if (p[k] !== undefined) o[k] = str(p[k], 4000); });
      return o.id;
    }
    case "opportunity.status": {
      const o = find(db.opportunities, p.id);
      if (!o) return null;
      assertOpenWeek(o.weekId);
      o.status = oneOf(p.status, OPP_STATUS, o.status);
      return o.id;
    }
    case "opportunity.delete": {
      admin();
      db.opportunities = db.opportunities.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- decisions ---- */
    case "decision.create": {
      admin(); assertOpenWeek(p.weekId);
      const number = db.decisions.filter((d) => d.weekId === p.weekId).length + 1;
      const d = {
        id: uid("d"), weekId: p.weekId, number, question: str(p.question, 400),
        decision: oneOf(p.decision, ["YES", "NO", "DEFERRED"], "YES"), reason: str(p.reason, 4000),
        date: str(p.date, 10) || ymd(new Date()), participants: str(p.participants, 300) || "All members",
        loggedBy: user.id, createdAt: nowISO(),
      };
      if (!d.question) throw new HttpError(400, "A decision needs a question.");
      db.decisions.push(d);
      return d.id;
    }
    case "decision.delete": {
      admin();
      db.decisions = db.decisions.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- meeting mode ---- */
    case "meeting.create": {
      assertOpenWeek(p.weekId);
      const m = {
        id: uid("mp"), weekId: p.weekId, promptId: str(p.promptId, 40), text: str(p.text, 2000),
        verdict: "", author: user.id, createdAt: nowISO(),
      };
      if (!m.text) throw new HttpError(400, "Write a point first.");
      db.meeting.push(m);
      return m.id;
    }
    case "meeting.verdict": {
      admin();
      const m = find(db.meeting, p.id);
      if (!m) return null;
      assertOpenWeek(m.weekId);
      m.verdict = oneOf(p.verdict, VERDICTS, "");
      return m.id;
    }
    case "meeting.delete": {
      const m = find(db.meeting, p.id);
      if (!m) return null;
      assertOpenWeek(m.weekId); owner(m.author);
      db.meeting = db.meeting.filter((x) => x.id !== p.id);
      return null;
    }

    /* ---- members ---- */
    case "member.create": {
      admin();
      const name = str(p.name, 60);
      if (!name) throw new HttpError(400, "A member needs a name.");
      if (db.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, "Someone already uses that name.");
      const m = {
        id: uid("u"), name, role: oneOf(p.role, ["ADMIN", "MEMBER"], "MEMBER"),
        password: hashPassword(str(p.password, 100) || "welcome123"), createdAt: nowISO(),
      };
      db.members.push(m);
      return m.id;
    }
    case "member.update": {
      const m = find(db.members, p.id);
      if (!m) throw new HttpError(400, "Unknown member.");
      if (!isAdmin && m.id !== user.id) throw new HttpError(403, "You can only edit your own account.");
      if (p.name !== undefined && str(p.name, 60)) m.name = str(p.name, 60);
      if (p.role !== undefined) { admin(); m.role = oneOf(p.role, ["ADMIN", "MEMBER"], m.role); }
      if (p.password) {
        if (!isAdmin && !verifyPassword(str(p.currentPassword, 100), m.password)) throw new HttpError(403, "That current password is not right.");
        if (String(p.password).length < 6) throw new HttpError(400, "Use at least six characters.");
        m.password = hashPassword(str(p.password, 100));
        Object.entries(db.sessions).forEach(([sid, s]) => { if (s.userId === m.id && sid !== p.keepSid) delete db.sessions[sid]; });
      }
      return m.id;
    }
    case "member.delete": {
      admin();
      if (p.id === user.id) throw new HttpError(400, "You cannot remove your own account.");
      const admins = db.members.filter((m) => m.role === "ADMIN");
      const target = find(db.members, p.id);
      if (target && target.role === "ADMIN" && admins.length <= 1) throw new HttpError(400, "The workspace needs at least one admin.");
      db.members = db.members.filter((m) => m.id !== p.id);
      db.tasks.forEach((t) => { if (t.assignee === p.id) t.assignee = ""; });
      db.branches.forEach((b) => { b.assignees = (b.assignees || []).filter((a) => a !== p.id); });
      Object.entries(db.sessions).forEach(([sid, s]) => { if (s.userId === p.id) delete db.sessions[sid]; });
      return null;
    }

    default:
      throw new HttpError(400, "Unknown action: " + type);
  }
}

/* ------------------------------- server ------------------------------- */
function publicState() {
  return {
    updatedAt: db.updatedAt,
    members: db.members.map(publicUser),
    weeks: db.weeks, branches: db.branches, tasks: db.tasks, findings: db.findings,
    resources: db.resources, notes: db.notes, comments: db.comments,
    opportunities: db.opportunities, decisions: db.decisions, meeting: db.meeting,
  };
}
function send(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {}));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 2e6) { reject(new HttpError(413, "That is too large.")); req.destroy(); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new HttpError(400, "Malformed request.")); } });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".json": "application/json" };

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(index)) { res.writeHead(200, { "Content-Type": MIME[".html"] }); return fs.createReadStream(index).pipe(res); }
    res.writeHead(404); return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  try {
    if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      const m = db.members.find((x) => x.name.toLowerCase() === str(body.name, 60).toLowerCase().trim());
      if (!m || !verifyPassword(str(body.password, 100), m.password)) {
        return send(res, 401, { error: "That name and password do not match." });
      }
      pruneSessions();
      const sid = crypto.randomBytes(24).toString("hex");
      db.sessions[sid] = { userId: m.id, createdAt: nowISO() };
      save();
      return send(res, 200, { user: publicUser(m) }, {
        "Set-Cookie": "sid=" + sid + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + SESSION_DAYS * 86400,
      });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const sid = parseCookies(req).sid;
      if (sid) { delete db.sessions[sid]; save(); }
      return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }

    const user = currentUser(req);
    if (!user) return send(res, 401, { error: "Please sign in." });
    
    if (pathname === "/api/download-workspace" && req.method === "GET") {
        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="workspace.json"',
            "Cache-Control": "no-store"
        });

        return fs.createReadStream(DATA_FILE).pipe(res);
    }

    if (pathname === "/api/state" && req.method === "GET") {
      return send(res, 200, { user: publicUser(user), state: publicState() });
    }
    if (pathname === "/api/op" && req.method === "POST") {
      const body = await readBody(req);
      const id = applyOp(user, str(body.type, 60), body.payload || {});
      save();
      return send(res, 200, { id, state: publicState() });
    }
    return send(res, 404, { error: "Unknown endpoint." });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server." });
  }
});

load();
pruneSessions();
server.listen(PORT, () => {
  console.log("Research Workspace is running on http://localhost:" + PORT);
  console.log("Data file: " + DATA_FILE);
});
