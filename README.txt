GUESS ???  -  2-player online word guessing game
================================================
Files: index.html, style.css, game.js  (PeerJS is loaded from a CDN, so internet is required)

RUN IT
1. Host the folder anywhere (Netlify Drop, GitHub Pages, any web host) OR run locally:
     python3 -m http.server 8000      then open http://localhost:8000
   Two devices on different networks need the game hosted online (same URL on both).
2. Player 1: enter name -> Create Room -> share the 4-letter code.
3. Player 2: enter name + code -> Join Room.

RULES
- Clue-giver sees a random secret word (Reroll available), sends max 3 words + max 3 emojis.
- Guesser has 3 chances. Correct on 1st/2nd/3rd try = 3/2/1 points; clue-giver gets 0. If all 3 guesses fail, the word is revealed and the clue-giver gets +3.
- Roles swap each round. First to 10 points wins (ties at 10+ go to sudden death).

NOTES
- Uses PeerJS's free public signalling server. Very strict networks/firewalls may need a TURN server.
- The host device is authoritative; the guesser's device never receives the secret word until the reveal.
