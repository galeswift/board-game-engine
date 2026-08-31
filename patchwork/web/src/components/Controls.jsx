export default function Controls({ onNewLocal, onNewMultiplayer, onShare, shareLabel }) {
  return (
    <div className="controls">
      <button id="newLocalGameBtn" onClick={onNewLocal}>New Local Game</button>
      <button id="newMultiplayerGameBtn" onClick={onNewMultiplayer}>New Multiplayer Game</button>
      <button id="shareBtn" onClick={onShare}>{shareLabel}</button>
    </div>
  );
}
