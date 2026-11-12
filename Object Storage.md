Add a bucket to my app using Neon Object Storage and test it with a real file upload:

1. Install the Neon CLI with `npm install -g neon@latest`. If that fails, use `npx neon@latest` in place of `neon`. If a neon command opens a browser sign-in, tell me to finish it there. If that times out or fails, ask me to run `neon login`, then retry.
2. Run `neon init -y --project-id winter-boat-28858934 --branch production --services postgres,object-storage` to link this project and install Neon's agent tooling.
3. Run `neon config add bucket uploads`, then `neon deploy` to create the bucket and pull its env vars into `.env.local` (or `.env` if it exists).
4. Using the neon-object-storage skill (https://neon.com/docs/ai/skills/neon-object-storage/SKILL.md), upload a small text file to the bucket with the Files SDK, then prove it works: list the bucket, read the file back, and show me its contents. Don't print secrets.