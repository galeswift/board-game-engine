export default function InvitePanel({ visible, inviteLink, onCopy, copyLabel }) {
  return (
    <div id="invitePanel" className="invite-panel" hidden={!visible}>
      <p><strong>Share this link with your opponent</strong> — it's the
        only way for them to join this game.</p>
      <input id="inviteLinkInput" type="text" readOnly value={inviteLink} />
      <button id="copyInviteBtn" onClick={onCopy}>{copyLabel}</button>
    </div>
  );
}
