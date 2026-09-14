# Research Workspace

A self-hosted web app for running a weekly team research sprint: one topic a week, broken into
branches, researched by everyone, compiled in one place, and turned into a decision at the weekend.

No build step, no framework, no external services. Node 18 or newer is the only requirement.

---

## Run it

```bash
cd research-workspace
node server.js
```

Open **http://localhost:3000**.

On first run the app creates `data/workspace.json` with four accounts and a sample week
(Electric Motors, seven branches, sample tasks and findings, plus one emergent idea):

| Name     | Password    | Role   |
|----------|-------------|--------|
| Admin    | `admin123`  | Admin  |
| Member 2 | `member123` | Member |
| Member 3 | `member123` | Member |
| Member 4 | `member123` | Member |

Change these on first sign-in (sidebar → the pencil next to your name). The admin can rename
people, reset passwords and add members from the **Team** screen.

Options:

```bash
PORT=8080 node server.js            # different port
DATA_DIR=/var/lib/research node server.js   # keep data somewhere else
```

## Let the team in

Everyone needs to reach the machine that runs the server.

- **Same office or wifi:** run it on one always-on machine and share `http://<that-machine-ip>:3000`.
- **Anywhere:** put it on a small VPS (a ₹400–600/month box is plenty for 13 people) and run it
  behind Caddy or Nginx with HTTPS. Sessions are cookies, so HTTPS matters once it leaves your LAN.
- **Keep it running:** `pm2 start server.js --name research` or a systemd unit.

Minimal Caddy config:

```
research.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## Backups

Everything lives in one file: `data/workspace.json`. Copy it on a schedule.

```bash
0 2 * * * cp /path/data/workspace.json /path/backups/workspace-$(date +\%F).json
```

If the file is ever unreadable the server keeps a copy next to it and starts fresh rather than
overwriting your history.

## How it is put together

```
server.js          HTTP server, sessions, permissions, every write operation
public/index.html  page shell
public/app.js      the whole interface (plain JavaScript, no build)
public/styles.css  styling
data/workspace.json  your data
```

Writes go through one function, `applyOp()` in `server.js`. Roles, validation and the
archived-week lock are enforced there, not in the browser, so nothing can be bypassed from
the client. Each entity (week, branch, task, finding, resource, note, comment, opportunity,
decision, meeting point, member) is a flat array in the JSON file, which maps one-to-one onto
tables if you later move to PostgreSQL: the operation names become your API routes and the
arrays become your tables.

Passwords are stored as scrypt hashes with per-user salts. Session cookies are HttpOnly and
last 30 days; changing a password signs out other devices.

## Growing it later

The shape was chosen to take these without restructuring: more members (add them in Team),
file uploads (a new array plus a static folder), exports (walk the same arrays), scoring and
voting (fields on `opportunities`), and a second team (a `teamId` on each record).
