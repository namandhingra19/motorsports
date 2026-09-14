# Putting this online so the whole team can use it

Running `node server.js` on your own laptop is fine for testing, but the app is only reachable
while that laptop is awake and on the same wifi. To give the team a permanent link, host it once.

## What you get

A private address such as `https://research-workspace.onrender.com`, working from any device
anywhere, always on, with HTTPS. Nobody has to install anything, and you never open a command
window again.

## Cost

About **$7.25 a month** (roughly ₹650) on Render:

- Starter web service — $7/month (always on, no sleeping)
- 1 GB persistent disk — $0.25/month (this is what keeps your data)
- Hobby workspace — free

There is no free option worth using: free instances have no permanent disk, so the workspace file
is wiped every time the app restarts.

## Steps

1. **GitHub account.** Sign up at github.com. Click **+** (top right) → **New repository**, name it
   `research-workspace`, choose **Private**, click **Create repository**.
2. **Upload the files.** On the empty repository page click **uploading an existing file**. Open the
   unzipped `research-workspace` folder, select everything inside it (`server.js`, `package.json`,
   `render.yaml`, `README.md`, `USER-GUIDE.md` and the `public` folder) and drag it into the browser.
   Wait for the upload to finish, then click **Commit changes**.
   Do not upload the `data` folder if you already ran the app locally — you want to start clean.
3. **Render account.** Go to render.com, click **Get Started**, and sign in with GitHub. Authorise it
   to read your repositories.
4. **Deploy.** In Render click **New** → **Blueprint**, pick the `research-workspace` repository, and
   click **Apply**. Render reads `render.yaml` and creates the service and the disk for you. Add a
   payment card when asked.
5. **Wait about two minutes** for the status to turn **Live**, then click the URL at the top of the
   page. That link is your workspace.
6. **Secure it immediately.** Sign in as `Admin` / `admin123`, open **Team**, and set a real password
   for every member. Then send the link and their passwords to the team.

## Afterwards

- **Logs and the starting passwords** are under the **Logs** tab in Render.
- **Backups:** open the **Shell** tab in Render and run `cat /var/data/workspace.json`, then copy the
  output into a file on your computer. Worth doing at the end of each month.
- **Turning it off:** suspend the service in Render settings. The disk and your data are kept.
- **Alternative host:** Railway ($5/month Hobby plan) works the same way — create a project from the
  GitHub repo, add a volume mounted at `/var/data`, and set the environment variable
  `DATA_DIR=/var/data`.
