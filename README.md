# Sinternacht

A first-person co-op horror game that runs in the browser. It's the night of 5 December and you're locked in His castle.

**Play:** https://phantomorion1.github.io/sinternacht/

> ⚠️ Extremely loud jumpscares and flashing images. Headphones make it much worse (in the good way).

## The goal

- Find the **four parts of the Silver Crossbow** on candlelit pedestals. Once it's whole, one silver bolt kills Him (you get three).
- **Hidden passages**: some walls are pivoting stone panels. A few work at any moment and which ones keeps changing. Look for hairline cracks and dust on a cold draft. He and his helpers can't follow you through.
- **Or escape**: one old door, in a sealed room deep in the castle, reachable only through a hidden passage. Forcing it open takes 6 loud seconds, and He will come for you.
- **His helpers** are covered in soot and harmless, until you touch one. Some crawl toward you, some just stand there staring, and some charge at you and veer off at the last second.
- **He** sees your flashlight from far away, and He can feel it when you shine it on Him. Turn the light off and crouch to hide. He hears you running.
- In co-op, if He catches your friend they end up in His sack, hanging somewhere in the castle. Follow the muffled screams and hold **E** to cut them down.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Shift | Run |
| C | Crouch (hold) |
| F | Flashlight |
| E | Take / use / hold to cut someone down |
| Left click | Shoot the crossbow |
| Esc | Pause |

## Co-op (2 players)

One player picks **Host a game** and sends the 4-letter code. The other picks **Join a friend** and types it in. The connection is peer-to-peer (PeerJS). The host's browser runs the monsters and the guest mirrors them.

Some strict networks (work or school Wi-Fi) block direct peer-to-peer connections. If you can't connect, add a TURN relay to `config.json`:

```json
{ "iceServers": [{ "urls": "turn:your-relay:3478", "username": "...", "credential": "..." }] }
```

## Tech

- Plain static site with no build step. Uses three.js r187 and PeerJS 1.5.5, both vendored in `vendor/`.
- Everything is generated in code: the castle maze, all textures, the faces, the models, and every sound (Web Audio synthesis with HRTF 3D audio, reverb and wall occlusion).
- Run it locally with any static server, e.g. `python3 -m http.server`, then open http://localhost:8000. Add `?mute` to the URL for silent testing.
