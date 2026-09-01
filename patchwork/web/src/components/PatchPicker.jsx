import { PATCHES, rotatePatch } from '../data/patches.js';
import PatchShape from './PatchShape.jsx';

// Every one of the 33 real patches, always shown (per the MVP scope -
// see docs/patchwork-next-steps.md - "present every possible piece").
// Greyed out once taken from the shared pool; `disabled` additionally
// covers "not your turn" / game not in-progress.
export default function PatchPicker({ availablePatches, playerMoney, selectedPatchId, onSelect, disabled }) {
  const available = new Set(availablePatches);

  return (
    <div id="patchPicker" className="patch-picker">
      {PATCHES.map((patch) => {
        const isAvailable = available.has(patch.id);
        const tooExpensive = patch.cost > playerMoney;
        const isSelected = patch.id === selectedPatchId;
        return (
          <button
            key={patch.id}
            className={['patch-tile', isSelected && 'selected'].filter(Boolean).join(' ')}
            disabled={disabled || !isAvailable || tooExpensive || isSelected}
            onClick={() => onSelect(patch.id)}
            title={patch.id}
            data-patch-id={patch.id}
          >
            <PatchShape shape={rotatePatch(patch, 0)} cost={patch.cost} time={patch.time} size={8} />
          </button>
        );
      })}
    </div>
  );
}
