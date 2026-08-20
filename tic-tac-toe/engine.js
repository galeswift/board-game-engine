'use strict';

// A deliberately minimal first pass. This is NOT the full command/event/
// phase architecture from the design docs - it's a small, honest
// implementation to get something real deployed and playable. The fuller
// architecture (deterministic context, command/event pipeline, phases,
// player-state map) can be layered in incrementally once this is live.

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

function createGame() {
  return {
    board: Array(9).fill(null),
    currentPlayer: 'X',
    winner: null,
    status: 'in-progress', // 'in-progress' | 'won' | 'draw'
  };
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

// Pure function: state -> Action[]. Each entry names an action type and
// the domain of legal values for each of its parameters, so a client can
// render enabled/disabled affordances (or a preview) without evaluating
// legality itself - it only ever reads this list, never state.board
// directly, to decide what's clickable.
function queryLegalActions(state) {
  if (state.status !== 'in-progress') {
    return [];
  }
  const domain = state.board.reduce((cells, cell, index) => {
    if (cell === null) cells.push(index);
    return cells;
  }, []);
  return [{ type: 'placePiece', params: { cell: { domain } } }];
}

// Pure function: (state, action) -> { state, error }
// Never mutates the input state.
function applyAction(state, action) {
  if (state.status !== 'in-progress') {
    return { state, error: 'game-over' };
  }
  if (!action || action.type !== 'placePiece') {
    return { state, error: 'unknown-action' };
  }

  const { cell } = action;
  if (typeof cell !== 'number' || cell < 0 || cell > 8 || !Number.isInteger(cell)) {
    return { state, error: 'invalid-cell' };
  }
  if (state.board[cell] !== null) {
    return { state, error: 'occupied' };
  }

  const board = state.board.slice();
  board[cell] = state.currentPlayer;

  const winner = checkWinner(board);
  const isDraw = !winner && board.every((c) => c !== null);

  const nextState = {
    board,
    currentPlayer: state.currentPlayer === 'X' ? 'O' : 'X',
    winner: winner || null,
    status: winner ? 'won' : isDraw ? 'draw' : 'in-progress',
  };

  return { state: nextState, error: null };
}

module.exports = { createGame, applyAction, queryLegalActions };
