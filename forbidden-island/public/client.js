const phaseEl = document.getElementById('phase');
const advanceBtn = document.getElementById('advanceBtn');

function render(phase) {
  phaseEl.textContent = `Phase: ${phase}`;
}

async function refresh() {
  const res = await fetch('/api/state');
  const data = await res.json();
  render(data.phase);
}

advanceBtn.addEventListener('click', async () => {
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'advancePhase' }),
  });
  const data = await res.json();
  if (data.phase) render(data.phase);
});

refresh();
