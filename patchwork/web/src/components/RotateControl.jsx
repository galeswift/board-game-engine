export default function RotateControl({ rotation, onRotate, disabled }) {
  return (
    <button id="rotateBtn" onClick={onRotate} disabled={disabled}>
      Rotate ({rotation * 90}°)
    </button>
  );
}
