import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
} from "solid-js";
import wordsText from "./words.txt?raw";
import "./App.css";

const WIDTH = 6;
const HEIGHT = 12;
const TICK_MS = 350;
const CLEAR_MS = 420;
const MIN_WORD_LENGTH = 3;
const DICTIONARY = wordsText
	.split("\n")
	.map((word) => word.trim().toUpperCase())
	.filter(
		(word) =>
			word.length >= MIN_WORD_LENGTH &&
			word.length <= WIDTH &&
			/^[A-Z]+$/.test(word),
	);
const WORD_SET = new Set(DICTIONARY);
const LETTER_BAG = "EEEEEEEEAAAARRRRIIIOOOTTNNNSSSLLDDGGBCMPFHKUVWY";
const LETTERS = Array.from(new Set(LETTER_BAG)).sort();
const LETTER_WEIGHTS = LETTER_BAG.split("").reduce<Record<string, number>>(
	(counts, letter) => {
		counts[letter] = (counts[letter] ?? 0) + 1;
		return counts;
	},
	{},
);
const TOTAL_LETTER_WEIGHT = LETTER_BAG.length;

type Cell = string | null;
type LetterCounts = Record<string, number>;

type ActivePiece = {
	letter: string;
	row: number;
	col: number;
};

type Match = {
	word: string;
	cells: Array<[number, number]>;
};

type CandidateMatch = {
	word: string;
	start: number;
	end: number;
};

type GameState = {
	grid: Cell[][];
	active: ActivePiece | null;
	letterCounts: LetterCounts;
	totalLettersSpawned: number;
	score: number;
	clears: number;
	lastClear: string;
	clearingMatches: Match[];
	paused: boolean;
	gameOver: boolean;
};

const emptyGrid = () =>
	Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));

const emptyLetterCounts = (): LetterCounts =>
	LETTERS.reduce<LetterCounts>((counts, letter) => {
		counts[letter] = 0;
		return counts;
	}, {});

const pickBalancedLetter = (
	letterCounts: LetterCounts,
	totalLettersSpawned: number,
) => {
	const weightedOptions = LETTERS.map((letter) => {
		const expectedCount =
			(totalLettersSpawned * LETTER_WEIGHTS[letter]) / TOTAL_LETTER_WEIGHT;
		const actualCount = letterCounts[letter] ?? 0;

		return {
			letter,
			weight: Math.max(0.25, expectedCount - actualCount + 1),
		};
	});

	const totalWeight = weightedOptions.reduce(
		(sum, option) => sum + option.weight,
		0,
	);
	let roll = Math.random() * totalWeight;

	for (const option of weightedOptions) {
		roll -= option.weight;
		if (roll <= 0) {
			return option.letter;
		}
	}

	return weightedOptions[weightedOptions.length - 1].letter;
};

const spawnPiece = (
	grid: Cell[][],
	letterCounts: LetterCounts,
	totalLettersSpawned: number,
): {
	active: ActivePiece | null;
	letterCounts: LetterCounts;
	totalLettersSpawned: number;
} => {
	const col = Math.floor(WIDTH / 2);

	if (grid[0][col] !== null) {
		return { active: null, letterCounts, totalLettersSpawned };
	}

	const letter = pickBalancedLetter(letterCounts, totalLettersSpawned);
	const nextLetterCounts = {
		...letterCounts,
		[letter]: (letterCounts[letter] ?? 0) + 1,
	};

	return {
		active: {
			letter,
			row: 0,
			col,
		},
		letterCounts: nextLetterCounts,
		totalLettersSpawned: totalLettersSpawned + 1,
	};
};

const createGame = (): GameState => {
	const grid = emptyGrid();
	const spawn = spawnPiece(grid, emptyLetterCounts(), 0);

	return {
		grid,
		active: spawn.active,
		letterCounts: spawn.letterCounts,
		totalLettersSpawned: spawn.totalLettersSpawned,
		score: 0,
		clears: 0,
		lastClear: "",
		clearingMatches: [],
		paused: false,
		gameOver: spawn.active === null,
	};
};

const cloneGrid = (grid: Cell[][]) => grid.map((row) => [...row]);

const collapseGrid = (grid: Cell[][]) => {
	const nextGrid = emptyGrid();

	for (let col = 0; col < WIDTH; col += 1) {
		const stack: string[] = [];

		for (let row = HEIGHT - 1; row >= 0; row -= 1) {
			const cell = grid[row][col];
			if (cell) stack.push(cell);
		}

		for (let index = 0; index < stack.length; index += 1) {
			nextGrid[HEIGHT - 1 - index][col] = stack[index];
		}
	}

	return nextGrid;
};

const pickRowMatches = (letters: string[], offset: number) => {
	const candidates: CandidateMatch[] = [];

	for (let left = 0; left < letters.length; left += 1) {
		for (
			let right = left + MIN_WORD_LENGTH;
			right <= letters.length;
			right += 1
		) {
			const word = letters.slice(left, right).join("");

			if (WORD_SET.has(word)) {
				candidates.push({
					word,
					start: offset + left,
					end: offset + right - 1,
				});
			}
		}
	}

	if (candidates.length === 0) {
		return [];
	}

	candidates.sort((a, b) => {
		if (a.start !== b.start) return a.start - b.start;
		return b.word.length - a.word.length;
	});

	const bestFrom = new Map<
		number,
		{ score: number; matches: CandidateMatch[] }
	>();

	const solve = (
		index: number,
	): { score: number; matches: CandidateMatch[] } => {
		const result = bestFrom.get(index);
		if (result) return result;

		const current = candidates[index];
		let best = { score: 0, matches: [] as CandidateMatch[] };

		for (let next = index + 1; next < candidates.length; next += 1) {
			if (candidates[next].start > current.end) {
				const tail = solve(next);
				const option = {
					score: current.word.length + tail.score,
					matches: [current, ...tail.matches],
				};

				if (option.score > best.score) {
					best = option;
				}
			}
		}

		if (best.score === 0) {
			best = { score: current.word.length, matches: [current] };
		}

		bestFrom.set(index, best);
		return best;
	};

	let best = { score: 0, matches: [] as CandidateMatch[] };

	for (let index = 0; index < candidates.length; index += 1) {
		const option = solve(index);

		if (option.score > best.score) {
			best = option;
		}
	}

	return best.matches;
};

const detectMatches = (grid: Cell[][]): Match[] => {
	const matches: Match[] = [];

	for (let row = 0; row < HEIGHT; row += 1) {
		let segmentStart = 0;

		while (segmentStart < WIDTH) {
			while (segmentStart < WIDTH && grid[row][segmentStart] === null) {
				segmentStart += 1;
			}

			let segmentEnd = segmentStart;
			while (segmentEnd < WIDTH && grid[row][segmentEnd] !== null) {
				segmentEnd += 1;
			}

			const letters = grid[row]
				.slice(segmentStart, segmentEnd)
				.filter((cell): cell is string => cell !== null);
			const rowMatches = pickRowMatches(letters, segmentStart);

			rowMatches.forEach((match) => {
				matches.push({
					word: match.word,
					cells: Array.from(
						{ length: match.end - match.start + 1 },
						(_, offset) => [row, match.start + offset],
					),
				});
			});

			segmentStart = segmentEnd + 1;
		}
	}

	for (let col = 0; col < WIDTH; col += 1) {
		let segmentStart = 0;

		while (segmentStart < HEIGHT) {
			while (segmentStart < HEIGHT && grid[segmentStart][col] === null) {
				segmentStart += 1;
			}

			let segmentEnd = segmentStart;
			while (segmentEnd < HEIGHT && grid[segmentEnd][col] !== null) {
				segmentEnd += 1;
			}

			const letters = Array.from(
				{ length: segmentEnd - segmentStart },
				(_, offset) => grid[segmentStart + offset][col],
			).filter((cell): cell is string => cell !== null);
			const columnMatches = pickRowMatches(letters, segmentStart);

			columnMatches.forEach((match) => {
				matches.push({
					word: match.word,
					cells: Array.from(
						{ length: match.end - match.start + 1 },
						(_, offset) => [match.start + offset, col],
					),
				});
			});

			segmentStart = segmentEnd + 1;
		}
	}

	return matches;
};

const queueMatches = (
	state: GameState,
	grid: Cell[][],
	matches: Match[],
): GameState => {
	if (matches.length === 0) {
		const spawn = spawnPiece(
			grid,
			state.letterCounts,
			state.totalLettersSpawned,
		);

		return {
			...state,
			grid,
			active: spawn.active,
			letterCounts: spawn.letterCounts,
			totalLettersSpawned: spawn.totalLettersSpawned,
			clearingMatches: [],
			gameOver: spawn.active === null,
		};
	}

	return {
		...state,
		grid,
		active: null,
		clearingMatches: matches,
		lastClear: matches.map((match) => match.word).join(" "),
		gameOver: false,
	};
};

const placePiece = (state: GameState): GameState => {
	if (!state.active) return state;

	const nextGrid = cloneGrid(state.grid);
	nextGrid[state.active.row][state.active.col] = state.active.letter;
	return queueMatches(state, nextGrid, detectMatches(nextGrid));
};

const resolveClearing = (state: GameState): GameState => {
	if (state.clearingMatches.length === 0) return state;

	const nextGrid = cloneGrid(state.grid);
	const cellsToClear = new Set(
		state.clearingMatches.flatMap((match) =>
			match.cells.map(([row, col]) => `${row}:${col}`),
		),
	);

	cellsToClear.forEach((key) => {
		const [row, col] = key.split(":").map(Number);
		nextGrid[row][col] = null;
	});

	const collapsedGrid = collapseGrid(nextGrid);
	const nextMatches = detectMatches(collapsedGrid);

	return queueMatches(
		{
			...state,
			score:
				state.score +
				state.clearingMatches.reduce(
					(total, match) => total + match.word.length * 25,
					0,
				),
			clears: state.clears + state.clearingMatches.length,
		},
		collapsedGrid,
		nextMatches,
	);
};

const stepGame = (state: GameState): GameState => {
	if (
		state.paused ||
		state.gameOver ||
		!state.active ||
		state.clearingMatches.length > 0
	)
		return state;

	const nextRow = state.active.row + 1;
	const blocked =
		nextRow >= HEIGHT || state.grid[nextRow][state.active.col] !== null;

	if (blocked) {
		return placePiece(state);
	}

	return {
		...state,
		active: {
			...state.active,
			row: nextRow,
		},
	};
};

const moveDown = (state: GameState): GameState => {
	if (
		state.paused ||
		state.gameOver ||
		!state.active ||
		state.clearingMatches.length > 0
	)
		return state;
	return stepGame(state);
};

function App() {
	const [game, setGame] = createSignal(createGame());

	onMount(() => {
		let clearTimeout: number | undefined;

		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "p" &&
				event.key !== "P" &&
				event.key !== "ArrowLeft" &&
				event.key !== "ArrowRight" &&
				event.key !== "ArrowDown"
			) {
				return;
			}

			event.preventDefault();

			setGame((current) => {
				if (event.key === "p" || event.key === "P") {
					if (current.gameOver) return current;
					return { ...current, paused: !current.paused };
				}

				if (event.key === "ArrowDown") {
					return moveDown(current);
				}

				if (
					current.paused ||
					current.gameOver ||
					!current.active ||
					current.clearingMatches.length > 0
				) {
					return current;
				}

				const delta = event.key === "ArrowLeft" ? -1 : 1;
				const nextCol = current.active.col + delta;

				if (nextCol < 0 || nextCol >= WIDTH) return current;
				if (current.grid[current.active.row][nextCol] !== null) return current;

				return {
					...current,
					active: {
						...current.active,
						col: nextCol,
					},
				};
			});
		};

		const interval = window.setInterval(() => {
			setGame((current) => stepGame(current));
		}, TICK_MS);

		const autoPause = () => {
			setGame((current) => {
				if (current.gameOver || current.paused) return current;
				return { ...current, paused: true };
			});
		};

		createEffect(() => {
			if (clearTimeout) {
				window.clearTimeout(clearTimeout);
				clearTimeout = undefined;
			}

			if (game().clearingMatches.length > 0 && !game().paused) {
				clearTimeout = window.setTimeout(() => {
					setGame((current) => resolveClearing(current));
				}, CLEAR_MS);
			}
		});

		const onVisibilityChange = () => {
			if (document.hidden) {
				autoPause();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", autoPause);
		document.addEventListener("visibilitychange", onVisibilityChange);

		onCleanup(() => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", autoPause);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.clearInterval(interval);
			if (clearTimeout) {
				window.clearTimeout(clearTimeout);
			}
		});
	});

	const visibleGrid = createMemo(() => {
		const base = cloneGrid(game().grid);

		const active = game().active;
		if (active) {
			base[active.row][active.col] = active.letter;
		}

		return base;
	});

	const clearingCells = createMemo(
		() =>
			new Set(
				game().clearingMatches.flatMap((match) =>
					match.cells.map(([row, col]) => `${row}:${col}`),
				),
			),
	);

	return (
		<main class="app">
			<header class="topbar">
				<h1>LETTRIS</h1>
				<div class="stats">
					<span>{game().score}</span>
					<span>{game().clears}</span>
					<button onClick={() => setGame(createGame())} type="button">
						Reset
					</button>
				</div>
			</header>

			<div class="status">
				<span>{game().active?.letter ?? "-"}</span>
				<span>{game().lastClear || "-"}</span>
			</div>

			<section class="board" aria-label="Lettris board">
				<For each={visibleGrid()}>
					{(row, rowIndex) => (
						<For each={row}>
							{(cell, columnIndex) => {
								const isActive =
									game().active?.row === rowIndex() &&
									game().active?.col === columnIndex();
								const isClearing = clearingCells().has(
									`${rowIndex()}:${columnIndex()}`,
								);

								return (
									<div
										class={`cell ${cell ? "filled" : ""} ${isActive ? "active" : ""} ${isClearing ? "clearing" : ""}`}
									>
										{cell ?? ""}
									</div>
								);
							}}
						</For>
					)}
				</For>
			</section>

			{game().paused && !game().gameOver && <div class="overlay">PAUSED</div>}
			{game().gameOver && <div class="gameover">GAME OVER</div>}
		</main>
	);
}

export default App;
