# The Box comments

`box-comments.js` is a small Cloudflare Worker that stores comments for The Box in a D1 database.
New comments stay hidden until they're approved at `/admin` on the Worker's address.
This folder starts with `_`, so GitHub Pages doesn't publish it on the website.

## Set up (Cloudflare dashboard, free plan)

1. **Database:** Storage & databases → D1 SQL database → Create. Name it `box-comments`.
2. **Worker:** Workers & Pages → Create → Worker → start from "Hello World". Name it `box-comments` and deploy.
3. **Code:** open the Worker → Edit code → delete everything → paste the whole of `box-comments.js` → Deploy.
4. **Connect the database:** Worker → Bindings → Add binding → D1 database.
   Variable name `DB`, database `box-comments`. Save.
5. **Admin key:** Worker → Settings → Variables and Secrets → Add.
   Type **Secret**, name `ADMIN_KEY`, value: a long password only you know. Deploy.
6. Copy the Worker's address (like `https://box-comments.yourname.workers.dev`) and put it in
   `COMMENTS_API` at the top of `the-box/box.js`.

The comments table is created automatically the first time the Worker runs.

## Approving comments

Go to `https://box-comments.brownalfie71.workers.dev/admin` and enter your admin key.
Approve shows a comment on the site. Hide takes it down again. Delete removes it for good.

## Optional: phone notifications

Install the free ntfy app, subscribe to a hard-to-guess topic name, then add a Worker variable
`NTFY_TOPIC` with that name. Each new comment then sends a notification that opens `/admin`.

## Updating the code

Paste the new `box-comments.js` into Edit code and deploy again. Comments are kept.
