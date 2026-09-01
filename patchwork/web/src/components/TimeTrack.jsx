export default function TimeTrack({ playerTimePositions }) {
  return (
    <div>
        <div>X Time: {playerTimePositions.X}</div>
        <div>O Time: {playerTimePositions.O}</div>
    </div>
  );
}
