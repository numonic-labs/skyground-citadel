# Assets

This repository holds the game's code. The 3D models, animations and textures are not in it.

- **To play:** the hosted game at https://numonic-skyground-citadel.vercel.app carries its own copy.
- **To run the code locally:** download the assets from the public collection at
  https://www.numonic.ai/gallery/53ab6b9612a5dbe123a3c0393475deaafcc0a975 and put them in `assets/`, using the layout
  listed below. Each item's title gives the path to save it under.
  - The 23 models (`.glb`) download exactly as the game uses them.
  - The four images (`skyline`, `grass`, `cliff`, `path`) download as WebP. Convert each one to PNG under the name in its
    title, for example `dwebp grass.webp -o assets/textures/grass.png` (from libwebp) or with any image editor.
  - Questions, or a file that will not load: ask in the Discord (https://discord.gg/tejSd5SkeD).
- **Licence:** the assets are released under Creative Commons Attribution 4.0 (CC BY 4.0), credit "Numonic Labs". They were
  made with generative AI tools. Whether copyright exists in generated models differs between countries, so in some places
  the attribution condition may not be enforceable; we ask for the credit anyway.
- three.js (in `node_modules` after `npm install`) is MIT-licensed by its authors.

## Layout

```
assets/kai_{idle,run,jump,flip,fall,hurt}.glb
assets/scenery/{island_a,island_b,island_c,island_d,castle,cliffwall,boardwalk,raft,fence,post,bush,coin,lantern,spring,flyer,waterfall,waypoint}.glb
assets/scenery/skyline.png
assets/textures/{grass,cliff,path}.png
```
