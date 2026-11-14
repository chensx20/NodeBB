'use strict';

module.exports = function (module) {
	module.listPrepend = async function (key, value) {
		if (!key) {
			return;
		}
		await module.client.lpush(key, value);
	};

	module.listAppend = async function (key, value) {
		if (!key) {
			return;
		}
		await module.client.rpush(key, value);
	};

	module.listRemoveLast = async function (key) {
		if (!key) {
			return;
		}
		return await module.client.rpop(key);
	};

	module.listRemoveAll = async function (key, value) {
		if (!key) {
			return;
		}
		value = Array.isArray(value) ? value : [value];
		await Promise.all(value.map(item => module.client.lrem(key, 0, item)));
	};

	module.listTrim = async function (key, start, stop) {
		if (!key) {
			return;
		}
		await module.client.ltrim(key, start, stop);
	};

	module.getListRange = async function (key, start, stop) {
		if (!key) {
			return;
		}
		return await module.client.lrange(key, start, stop);
	};

	module.listLength = async function (key) {
		return await module.client.llen(key);
	};
};
