
async function setSongAvatar(imageUrl) {
    if (!ENABLE_SONG_AVATAR) {
        console.log("setSongAvatar: feature disabled");
        return false;
    }

    if (!imageUrl) {
        console.log("setSongAvatar: no imageUrl provided");
        return false;
    }

    if (!client.user) {
        console.log("setSongAvatar: client.user not ready");
        return false;
    }

    const now = Date.now();
    if (now - lastAvatarChange < AVATAR_CHANGE_COOLDOWN_MS) {
        console.log(`setSongAvatar: cooldown in effect (${now - lastAvatarChange}ms < ${AVATAR_CHANGE_COOLDOWN_MS}ms)`);
        return false;
    }

    console.log(`setSongAvatar: attempting to fetch image ${imageUrl}`);
    const buf = await fetchAndMaybeResize(imageUrl, MAX_AVATAR_BYTES);
    if (!buf) {
        console.log("setSongAvatar: failed to fetch or image rejected");
        return false;
    }

    try {
        // store original avatar if not stored
        if (!originalAvatarBuffer) {
            try {
                const origUrl = client.user.displayAvatarURL({ format: "png", size: 256 });
                console.log(`setSongAvatar: fetching original avatar from ${origUrl}`);
                const origBuf = await fetchAndMaybeResize(origUrl, MAX_AVATAR_BYTES);
                if (origBuf) {
                    originalAvatarBuffer = origBuf;
                    console.log(`setSongAvatar: stored original avatar (${origBuf.length} bytes)`);
                }
            } catch (e) {
                console.warn("setSongAvatar: failed fetching original avatar:", e && e.message ? e.message : e);
            }
        }

        await client.user.setAvatar(buf);
        lastAvatarChange = Date.now();
        console.log("Changed bot avatar to song art");
        return true;
    } catch (e) {
        console.warn("Failed to set song avatar:", e && e.message ? e.message : e);
        return false;
    }
}