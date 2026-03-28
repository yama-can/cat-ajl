const fs = require('fs');

const delayPromises = [];

const RATE_LIMIT_DELAY = 200; // 200ms delay to avoid hitting rate limits
const MAX_CONTESTS = 6;

async function rateLimitDelay() {

	if (delayPromises.length >= 1) {

		const newPromise = new Promise(resolve => {
			delayPromises[delayPromises.length - 1].then(() => {
				setTimeout(resolve, RATE_LIMIT_DELAY);
			});
		});

		delayPromises.push(newPromise);

		return newPromise;

	}

	const newPromise = new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

	delayPromises.push(newPromise);

	return newPromise;

}

const memCache = {};

async function cache(key, fetchFunc, revalidate = null) {

	if (memCache[key] !== undefined) {
		return memCache[key];
	}

	fs.mkdirSync('cache', { recursive: true });

	const cacheFile = `cache/${key}.json`;

	if (fs.existsSync(cacheFile)) {

		const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

		if (new Date(cacheData.expiresAt).getTime() > Date.now()) {
			return memCache[key] = cacheData.response;
		}

	}

	const response = await fetchFunc();

	fs.writeFileSync(
		cacheFile,
		JSON.stringify(
			{
				response,
				// If revalidate is not provided, use 1000 days as the default cache duration
				expiresAt: new Date(Date.now() + (revalidate || 1000 * 365 * 24 * 3600 * 1000)).toISOString(),
			}, null, 2
		),
		'utf-8'
	);

	return memCache[key] = response;

}

async function getContestStandings(contestScreenName) {

	const target = contestScreenName.match(/(.*)\.contest\.atcoder\.jp/)[1];

	return cache(`contest_standings_${target}`, async () => {

		// 200ms delay to avoid hitting rate limits

		await rateLimitDelay();

		console.log(`Fetching standings for contest: ${target}`);

		return await fetch(`https://atcoder.jp/contests/${target}/results/json`).then(response => response.json());

	}); // No need to revalidate contest standings as they won't change after the contest ends

}

async function getUserHistory(user) {

	return cache(`user_history_${user}`, async () => {

		// 200ms delay to avoid hitting rate limits

		await rateLimitDelay();

		console.log(`Fetching history for user: ${user}`);

		return await fetch(`https://atcoder.jp/users/${user}/history/json`).then(response => response.json());

	}, 1000 * 24 * 3600); // Revalidate user history everyday

}

async function main() {

	const file = fs.readFileSync('input.txt', 'utf-8').split('\n');

	const startTime = new Date(file[0].trim()).getTime();
	const endTime = new Date(file[1].trim()).getTime();

	const teams = file.slice(2).filter(line => Boolean(line.trim())).map(
		line =>
		({
			teamname: line.split(': ')[0],
			users: line.split(': ')[1].split(/[\s\t]/).map(value => value.trim()).filter(Boolean)
		})
	);

	const users = teams.flatMap(team => team.users);

	const uniqueUsers = new Set(users);

	console.log(`Total users: ${users.length}`);
	console.log(`Unique users: ${uniqueUsers.size}`);

	const userData = {};
	const userScores = {};

	const targetContests = new Map();

	let now = 0;

	for (const user of uniqueUsers) {

		if (now % 10 === 0) {
			console.log(`Processing user ${now + 1} / ${uniqueUsers.size}`);
		}
		now++;

		userData[user] = await getUserHistory(user);

		const list = await Promise.all(userData[user].map(async entry => {

			entry.EndTime = new Date(entry.EndTime).getTime();

			if (entry.EndTime >= startTime && entry.EndTime <= endTime) {

				targetContests.set(entry.ContestScreenName, entry);

				if (!entry.IsRated) {

					const contestData = await getContestStandings(entry.ContestScreenName);

					if (contestData) {

						let performanceEntry = contestData.findIndex(e => e.UserScreenName === user);

						if (contestData[performanceEntry].Place == contestData[contestData.length - 1].Place) {
							// No score for 0 points, even if rated
							return entry.ajlScore = 0;
						}

						if (performanceEntry !== -1) {

							let upperBound = performanceEntry;
							let lowerBound = performanceEntry;

							while (!contestData[upperBound].IsRated) {
								upperBound++;
							}
							while (!contestData[lowerBound].IsRated) {
								lowerBound--;
							}

							if (contestData[upperBound].IsRated && contestData[lowerBound].IsRated) {
								// Linear
								entry.Performance = contestData[lowerBound].Performance + (contestData[upperBound].Performance - contestData[lowerBound].Performance) * (performanceEntry - lowerBound) / (upperBound - lowerBound);
							} else if (contestData[upperBound].IsRated) {
								entry.Performance = contestData[performanceEntry].Performance;
							} else if (contestData[lowerBound].IsRated) {
								entry.Performance = contestData[performanceEntry].Performance;
							} else {
								entry.Performance = 0;
							}

							entry.Performance = Math.round(entry.Performance);

						} else {
							entry.Performance = 0;
						}

					} else {
						entry.Performance = 0;
					}

				}

				return entry.ajlScore = Math.pow(2, entry.Performance / 400) * 1000;

			}

			return entry.ajlScore = 0;

		}));

		userScores[user] = list.sort((a, b) => b - a).slice(0, MAX_CONTESTS).reduce((acc, score) => acc + score, 0);

	}

	fs.mkdirSync('output', { recursive: true });

	fs.writeFileSync('output/user_data.json', JSON.stringify(userData, null, 2), 'utf-8');

	const teamScores = teams.map(team => {

		const score = team.users.map(user => userScores[user] || 0).reduce((acc, score) => acc + score, 0);

		return { teamname: team.teamname, score };

	}).sort((a, b) => b.score - a.score);

	console.log('Team Scores:');
	teamScores.forEach((team, i) => {
		console.log(`#${i + 1} ${team.teamname}: ${team.score.toFixed(2)}`);
	});

	const timeSortedTargetContestNames = Array.from(targetContests).map(value => value[1]).sort((a, b) => {

		return new Date(a.EndTime).getTime() - new Date(b.EndTime).getTime();

	});

	fs.writeFileSync('output/team_scores.json', JSON.stringify(teamScores, null, 2), 'utf-8');
	fs.writeFileSync('output/target_contests.json', JSON.stringify(timeSortedTargetContestNames, null, 2), 'utf-8');
	fs.writeFileSync('output/user_scores.json', JSON.stringify(userScores, null, 2), 'utf-8');

	let template = fs.readFileSync('template.md', 'utf-8');

	template = template.replace('[[ABSTRACT_REPORT]]', teamScores.map((team, i) => `#${i + 1} ${team.teamname}: ${team.score.toFixed(2)}`).join('\n'), 'utf-8');

	template = template.replace(
		'[[USER_RANKING_TABLE]]',
		`| Rank | User | Score | ${timeSortedTargetContestNames.map(contest => contest.ContestNameEn || contest.ContestName).join(' | ')} |\n` +
		`| --- | --- | --- | ${timeSortedTargetContestNames.map(() => '---').join(' | ')} |\n` +
		Object.entries(userScores)
			.sort((a, b) => b[1] - a[1])
			.map(([user, score], i) => {
				const userEntries = userData[user].filter(entry => {
					const entryTime = new Date(entry.EndTime).getTime();
					return entryTime >= startTime && entryTime <= endTime;
				});
				const contestMap = {};
				const userScores = [];
				userEntries.forEach(entry => {
					contestMap[entry.ContestScreenName] = entry.ajlScore || 0;
					userScores.push(entry.ajlScore || 0);
				});
				// Bold each top-6 scores
				const sixthScore = userScores.length < 6 ? -Infinity : Object.values(userScores).sort((a, b) => b - a)[5];
				return `| #${i + 1} | ${user} | ${score.toFixed(2)} | ${timeSortedTargetContestNames.map(contest => contest.ContestScreenName).map(contest => contestMap[contest] ? contestMap[contest] : 0).map(value => value >= sixthScore ? `**${value.toFixed(2)}**` : value.toFixed(2)).join(' | ')} |`;
			})
			.join('\n')
	);

	template = template.replace(
		'[[TEAM_RANKING_TABLE]]',
		`| Rank | Team | Score | ${timeSortedTargetContestNames.map(contest => contest.ContestNameEn || contest.ContestName).join(' | ')} |\n` +
		`| --- | --- | --- | ${timeSortedTargetContestNames.map(() => '---').join(' | ')} |\n` +
		teamScores.map((team, i) => {
			const teamUsers = teams.find(t => t.teamname === team.teamname).users;
			const contestMap = {};
			teamUsers.forEach(user => {
				const userEntries = userData[user].filter(entry => {
					const entryTime = new Date(entry.EndTime).getTime();
					return entryTime >= startTime && entryTime <= endTime;
				});
				userEntries.forEach(entry => {
					if (!contestMap[entry.ContestScreenName]) {
						contestMap[entry.ContestScreenName] = 0;
					}
					contestMap[entry.ContestScreenName] += entry.ajlScore || 0;
				});
			});
			return `| #${i + 1} | ${team.teamname} | ${team.score.toFixed(2)} | ${timeSortedTargetContestNames.map(contest => contest.ContestScreenName).map(contest => contestMap[contest] ? contestMap[contest].toFixed(2) : '0.00').join(' | ')} |`;
		}).join('\n')
	);

	template = template.replace('[[START_TIME]]', new Date(startTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
	template = template.replace('[[END_TIME]]', new Date(endTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));

	template = template.replace('[[TOTAL_USERS]]', users.length.toString());
	template = template.replace('[[UNIQUE_USERS]]', uniqueUsers.size.toString());

	template = template.replace('[[CONTESTS_LIST]]', timeSortedTargetContestNames.map(contest => `- [${contest.ContestNameEn || contest.ContestName}](https://${contest.ContestScreenName})`).join('\n'), 'utf-8');

	fs.writeFileSync('output/report.md', template, 'utf-8');

}

main();
