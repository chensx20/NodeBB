'use strict';

const assert = require('assert');
const db = require('./mocks/databasemock');
const user = require('../src/user');
const groups = require('../src/groups');
const messaging = require('../src/messaging');
const api = require('../src/api');
const migration = require('../src/upgrades/4.3.0/chat_lists');

describe('Chat privacy', () => {
	let sender;
	let recipient;
	let other;
	let admin;
	let globalMod;
	let roomId;
	const restricted = { message: '[[error:chat-restricted]]' };
	const caller = uid => ({ uid, session: {} });
	const save = settings => api.users.updateSettings({ uid: recipient }, { uid: recipient, settings });

	before(async () => {
		[sender, recipient, other, admin, globalMod] = await Promise.all(
			['sender', 'recipient', 'other', 'admin', 'globalmod'].map(name => user.create({ username: `privacy-${name}` }))
		);
		[sender, recipient, other, admin, globalMod] = [sender, recipient, other, admin, globalMod].map(Number);
		await groups.join('administrators', admin);
		await groups.join('Global Moderators', globalMod);
		roomId = await messaging.newRoom(sender, { uids: [recipient, other, admin, globalMod] });
	});

	beforeEach(async () => {
		await db.setObject(`user:${recipient}:settings`, {
			restrictChat: 0,
			disableIncomingChats: 0,
			chatAllowList: '[]',
			chatDenyList: '[]',
		});
	});

	it('defaults to empty numeric lists and incoming chats enabled', async () => {
		const settings = await user.getSettings(other);
		assert.deepStrictEqual(settings.chatAllowList, []);
		assert.deepStrictEqual(settings.chatDenyList, []);
		assert.strictEqual(settings.disableIncomingChats, false);
		await messaging.canMessageUser(sender, recipient);
	});

	it('persists, deduplicates, and preserves preferences on unrelated settings updates', async () => {
		await save({ chatAllowList: [sender, sender], chatDenyList: [other, other], disableIncomingChats: true });
		const settings = await save({ showemail: 1 });
		assert.deepStrictEqual(settings.chatAllowList, [sender]);
		assert.deepStrictEqual(settings.chatDenyList, [other]);
		assert.strictEqual(settings.disableIncomingChats, true);
		assert.strictEqual(await db.getObjectField(`user:${recipient}:settings`, 'chatAllowList'), JSON.stringify([sender]));
		await save({ chatAllowList: [], chatDenyList: [], disableIncomingChats: false });
		await messaging.canMessageUser(sender, recipient);
	});

	for (const field of ['chatAllowList', 'chatDenyList']) {
		for (const invalid of [null, '[]', {}, [0], [-1], [1.5], ['1'], [true]]) {
			it(`rejects invalid ${field}: ${JSON.stringify(invalid)}`, async () => {
				await assert.rejects(save({ [field]: invalid }), { message: '[[error:invalid-data]]' });
			});
		}
		it(`rejects self and nonexistent users in ${field}`, async () => {
			await assert.rejects(save({ [field]: [recipient] }), { message: '[[error:invalid-data]]' });
			await assert.rejects(save({ [field]: [Number.MAX_SAFE_INTEGER] }), { message: '[[error:no-user]]' });
		});
	}

	it('rejects invalid incoming-chat flags', async () => {
		await assert.rejects(save({ disableIncomingChats: 'false' }), { message: '[[error:invalid-data]]' });
	});

	it('retains existing settings authorization', async () => {
		await assert.rejects(api.users.updateSettings({ uid: sender }, {
			uid: recipient, settings: { chatDenyList: [other] },
		}), { message: '[[error:no-privileges]]' });
		assert.deepStrictEqual((await user.getSettings(recipient)).chatDenyList, []);
	});

	it('allows only allow-listed senders when the allow list is non-empty', async () => {
		await save({ chatAllowList: [sender] });
		await messaging.canMessageUser(sender, recipient);
		await assert.rejects(messaging.canMessageUser(other, recipient), restricted);
	});

	it('denies listed non-staff even when also allowed', async () => {
		await save({ chatAllowList: [sender], chatDenyList: [sender] });
		await assert.rejects(messaging.canMessageUser(sender, recipient), restricted);
	});

	it('permits unlisted senders with only a deny list', async () => {
		await save({ restrictChat: 1, chatDenyList: [other] });
		await messaging.canMessageUser(sender, recipient);
		await assert.rejects(messaging.canMessageUser(other, recipient), restricted);
	});

	it('retains legacy follow restrictions only when both lists are empty', async () => {
		await save({ restrictChat: 1 });
		await assert.rejects(messaging.canMessageUser(sender, recipient), restricted);
		await user.follow(recipient, sender);
		await messaging.canMessageUser(sender, recipient);
		await user.unfollow(recipient, sender);
	});

	for (const role of ['administrator', 'global moderator']) {
		it(`allows ${role} to bypass allow and legacy restrictions, but not deny or disabled chats`, async () => {
			const uid = role === 'administrator' ? admin : globalMod;
			await save({ restrictChat: 1, chatAllowList: [other] });
			await messaging.canMessageUser(uid, recipient);
			await messaging.canMessageRoom(uid, roomId);
			await save({ chatDenyList: [uid] });
			await assert.rejects(messaging.canMessageUser(uid, recipient), restricted);
			await assert.rejects(messaging.canMessageRoom(uid, roomId), restricted);
			await save({ disableIncomingChats: 1 });
			await assert.rejects(messaging.canMessageUser(uid, recipient), restricted);
			await assert.rejects(messaging.canMessageRoom(uid, roomId), restricted);
		});
	}

	it('disabled incoming chats overrides an allowed sender', async () => {
		await save({ chatAllowList: [sender], disableIncomingChats: 1 });
		await assert.rejects(messaging.canMessageUser(sender, recipient), restricted);
	});

	it('preserves existing block behavior even for allowed senders', async () => {
		await save({ chatAllowList: [sender] });
		await user.blocks.add(sender, recipient);
		await assert.rejects(messaging.canMessageUser(sender, recipient), { message: '[[error:chat-user-blocked]]' });
		await user.blocks.remove(sender, recipient);
	});

	it('rejects starting and inviting through the chat API', async () => {
		await save({ chatDenyList: [sender] });
		await assert.rejects(api.chats.create(caller(sender), { uids: [recipient] }), restricted);
		const room = await messaging.newRoom(sender, { uids: [other] });
		await assert.rejects(api.chats.invite(caller(sender), { roomId: room, uids: [recipient] }), restricted);
		assert.strictEqual(await messaging.isUserInRoom(recipient, room), false);
	});

	it('enforces preference changes on existing private room posts without storing a message', async () => {
		await save({ chatDenyList: [sender] });
		const count = await db.getObjectField(`chat:room:${roomId}`, 'messageCount');
		await assert.rejects(api.chats.post(caller(sender), { roomId, message: 'must not be stored' }), restricted);
		assert.strictEqual(await db.getObjectField(`chat:room:${roomId}`, 'messageCount'), count);
		await save({ chatDenyList: [] });
		const message = await api.chats.post(caller(sender), { roomId, message: 'now permitted' });
		assert.strictEqual(message.content, 'now permitted');
	});

	it('leaves public room posting unchanged', async () => {
		const publicRoom = await messaging.newRoom(sender, { type: 'public', uids: [recipient] });
		await save({ disableIncomingChats: 1, chatDenyList: [sender] });
		await messaging.canMessageRoom(sender, publicRoom);
		const message = await api.chats.post(caller(sender), { roomId: publicRoom, message: 'public message' });
		assert.strictEqual(message.content, 'public message');
	});

	describe('upgrade', () => {
		let legacy;
		const run = () => migration.method.call({ progress: { incr() {} } });
		beforeEach(async () => {
			legacy = Number(await user.create({ username: `legacy-${Date.now()}` }));
			await user.setSetting(legacy, 'restrictChat', 1);
		});

		it('seeds numeric follows once and preserves subsequent choices on reruns', async () => {
			await user.follow(legacy, sender);
			await run();
			assert.deepStrictEqual((await user.getSettings(legacy)).chatAllowList, [sender]);
			assert.strictEqual(Number(await db.getObjectField(`user:${legacy}:settings`, 'chatListsMigrated')), 1);
			await api.users.updateSettings({ uid: legacy }, { uid: legacy, settings: { chatAllowList: [] } });
			await user.follow(legacy, other);
			await run();
			assert.deepStrictEqual((await user.getSettings(legacy)).chatAllowList, []);
		});

		it('does not overwrite explicit preferences made before migration', async () => {
			await user.follow(legacy, sender);
			await api.users.updateSettings({ uid: legacy }, { uid: legacy, settings: { chatAllowList: [other] } });
			await run();
			assert.deepStrictEqual((await user.getSettings(legacy)).chatAllowList, [other]);
		});

		it('handles empty follows while retaining the legacy restriction', async () => {
			await run();
			const settings = await user.getSettings(legacy);
			assert.deepStrictEqual(settings.chatAllowList, []);
			assert.strictEqual(settings.restrictChat, true);
			await assert.rejects(messaging.canMessageUser(sender, legacy), restricted);
		});

		it('does not seed accounts without legacy restrictions', async () => {
			await user.follow(other, sender);
			await run();
			assert.deepStrictEqual((await user.getSettings(other)).chatAllowList, []);
			await user.unfollow(other, sender);
		});
	});
});
