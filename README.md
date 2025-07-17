# Digital Digital Diary
## Video URL: https://youtu.be/ZR7ZmUQUYdw

A super simple extension that tracks how you waste (or maybe use?) your time online.

## what it does
- tracks what sites you visit + how long you're there
- sorts them into categories like “entertainment”, “learning”, “shopping”, etc.
- shows you a daily summary in a clean popup (no fancy dashboards, just vibes)
- uses google gemini to summarize stuff you read or watch (like articles, podcasts)
- gives suggestions like “yo maybe read more tomorrow” if you're slacking

## how to install it
1. download this folder (or clone the repo if you’re fancy)
2. go to `chrome://extensions/` in your chrome browser
3. turn on “developer mode” (top right)
4. hit “load unpacked” and pick this folder
5. it should show up in your toolbar (if not, pin it)
6. click it anytime to see your digital life report

## setup note
- to make summaries work, you’ll need your own free gemini API key (from [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey))
- once you get the key, paste it in `trackingtabs.js` where it says `YOUR_API_KEY_HERE`

## files
- `manifest.json` → extension config
- `trackingtabs.js` → watches your tabs + logs time + talks to gemini
- `dataextraction.js` → grabs article content from pages you visit
- `script.js` → powers the popup view
- `ui.html` + `style.css` → the lil summary window design
- `icons/` → just an icon. not that deep.

## disclaimer
this doesn’t upload or share any of your data. it’s just for you to see where your time goes.
no tracking, no ads, no bloat. just personal reflection.

made as my final project for CS50x 2025.
