<fieldset class="mt-3" component="account/chat-settings">
	<legend class="h6">[[user:chat-privacy]]</legend>
	<div class="form-check mb-2">
		<input id="disableIncomingChats" class="form-check-input" type="checkbox" data-property="disableIncomingChats" {{{ if disableIncomingChats }}}checked{{{ end }}} />
		<label for="disableIncomingChats" class="form-check-label">[[user:disable-incoming-chats]]</label>
	</div>
	<p class="text-muted">[[user:chat-lists-help]]</p>
	<label for="chatAllowList" class="form-label">[[user:chat-allow-list]]</label>
	<input id="chatAllowList" class="form-control mb-2" type="text" data-property="chatAllowList" value="{chatAllowList}" aria-describedby="chat-list-format" />
	<label for="chatDenyList" class="form-label">[[user:chat-deny-list]]</label>
	<input id="chatDenyList" class="form-control" type="text" data-property="chatDenyList" value="{chatDenyList}" aria-describedby="chat-list-format" />
	<p id="chat-list-format" class="form-text">[[user:chat-list-format]]</p>
</fieldset>
