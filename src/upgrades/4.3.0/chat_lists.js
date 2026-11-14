'use strict';

const db = require('../../database');
const batch = require('../../batch');

module.exports = {
	name: 'Seed chat allow lists from legacy follow restrictions',
	timestamp: Date.UTC(2026, 10, 14),
	method: async function () {
		const { progress } = this;
		progress.total = await db.sortedSetCard('users:joindate');
		await batch.processSortedSet('users:joindate', async (uids) => {
			await Promise.all(uids.map(async (uid) => {
				const key = `user:${uid}:settings`;
				const settings = await db.getObject(key);
				if (!settings || Number(settings.restrictChat) !== 1 || Number(settings.chatListsMigrated) === 1) {
					return;
				}
				const updates = { chatListsMigrated: 1 };
				if (settings.chatAllowList === undefined && settings.chatDenyList === undefined &&
					settings.disableIncomingChats === undefined) {
					const following = await db.getSortedSetRange(`following:${uid}`, 0, -1);
					updates.chatAllowList = JSON.stringify(following.map(Number));
				}
				await db.setObject(key, updates);
			}));
			progress.incr(uids.length);
		}, { batch: 500 });
	},
};
