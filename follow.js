const USER_ID = "6590127737364676614";
const GOAL = 10000;

function drawProgress(followers) {
    const percent = Math.min((followers / GOAL) * 100, 100);

    const width = 40;
    const filled = Math.round((percent / 100) * width);

    const green = "\x1b[32m";
    const gray = "\x1b[90m";
    const cyan = "\x1b[36m";
    const reset = "\x1b[0m";

    console.clear();

    console.log(`${cyan}TikTok 10K Goal${reset}\n`);

    console.log(
        `Followers: ${followers.toLocaleString()} / ${GOAL.toLocaleString()}`
    );

    console.log(
        "[" +
        green +
        "█".repeat(filled) +
        gray +
        "░".repeat(width - filled) +
        reset +
        `] ${percent.toFixed(2)}%`
    );

    console.log(
        `Remaining: ${Math.max(GOAL - followers, 0).toLocaleString()}`
    );

    console.log(
        `Updated: ${new Date().toLocaleTimeString()}`
    );
}

async function getFollowers() {
    const response = await fetch(
        `https://tiktok-api.tokcounter.com/user/stats/${USER_ID}`
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("API Response:", data);

    const followers =
        data.followerCount ??
        data.data?.followerCount ??
        data.followers ??
        data.data?.followers;

    if (followers === undefined || followers === null) {
        throw new Error("Follower count not found in API response.");
    }

    return Number(followers);
}

async function update() {
    try {
        const followers = await getFollowers();
        drawProgress(followers);
    } catch (err) {
        console.log("Error:", err.message);
    }

    // Update every 5 seconds
    setTimeout(update, 5000);
}

update();