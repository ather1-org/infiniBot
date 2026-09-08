// // capture original avatar (if avatar swap enabled)
// if (ENABLE_SONG_AVATAR) {
//     try {
//         const url = client.user.displayAvatarURL({ format: "png", size: 256 });
//         const buf = await fetchAndMaybeResize(url, MAX_AVATAR_BYTES);
//         if (buf) originalAvatarBuffer = buf;
//     } catch (e) {
//         console.warn("Failed to fetch original avatar:", e && e.message ? e.message : e);
//     }
// }