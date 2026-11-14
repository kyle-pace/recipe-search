---
name: bump-kp-design
description: Change kp-design (Kyle's shared design system for his websites) and roll the change out to every site that uses it. Use when a change belongs in the shared header, footer, tokens, display settings, layouts or analytics, or when asked to update, bump or pin kp-design.
---

# Changing kp-design and rolling it out

kp-design ([kyle-pace/kp-design](https://github.com/kyle-pace/kp-design)) is installed in each site straight from GitHub and pinned to one commit in `package.json`:

```json
"kp-design": "github:kyle-pace/kp-design#<full commit SHA>"
```

Pinning means a site only gets a kp-design change when its pin moves, so one site can't break because another needed something new. It also means a change isn't finished until every site's pin has moved.

## Steps

1. **Make the change in kp-design**, not in a site. Bump its version in `package.json` (patch for a fix, minor for something new) and push. Note the new commit's full SHA.
2. **Try it in one site first.** In that site: `npm install github:kyle-pace/kp-design#<SHA>`, then `npm run build` and `npm run check`. Look at the screenshots for whatever the change touches.
3. **Roll it out to the rest.** Find them by searching Kyle's repos for `kp-design` in `package.json`. As of November 2026: kylepace.net, kylepace.dev, skill-tree, cuisine-explorer (World cuisine), wa-transit-map and recipe-search. Check for newer ones. In each: install the same SHA, build, run the check, push.
4. **Report** which sites are on the new pin and any that aren't, with the reason.

## Notes

- Use the commit SHA, not a tag or branch name.
- Commit the updated `package-lock.json` with the pin.
- kylepace.dev's nav and footer links and its Amplitude project live in kp-design's `lib/kylepace-dev.ts`. Changing a link there is a kp-design change and follows these steps.
- kp-design bumps don't count as activity for a lab's place on kylepace.dev, so there's no need for a ship log line unless visitors would notice the change.
