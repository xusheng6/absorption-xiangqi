"""
Pikafish UCI Engine Wrapper for Absorption Xiangqi
Communicates with the Pikafish engine via UCI protocol.
"""

import subprocess
import threading
import queue
import os
from typing import Optional, Tuple

# Map website piece types to UCI piece chars
PIECE_TO_CHAR = {
    'chariot': 'r',
    'horse': 'n',
    'elephant': 'b',
    'advisor': 'a',
    'general': 'k',
    'cannon': 'c',
    'soldier': 'p'
}

CHAR_TO_PIECE = {v: k for k, v in PIECE_TO_CHAR.items()}

# Difficulty settings: depth for search
# Min depth is 20, max time defaults to 3 seconds
DIFFICULTY_SETTINGS = {
    'easy': {'depth': 20, 'movetime': 3000},
    'medium': {'depth': 22, 'movetime': 3000},
    'hard': {'depth': 24, 'movetime': 5000},
    'extreme': {'depth': 28, 'movetime': 10000},
    'pikafish_easy': {'depth': 20, 'movetime': 3000},
    'pikafish_medium': {'depth': 22, 'movetime': 3000},
    'pikafish_hard': {'depth': 24, 'movetime': 5000},
    'pikafish_extreme': {'depth': 28, 'movetime': 10000},
}

# Get system thread count for default
import multiprocessing
DEFAULT_THREADS = multiprocessing.cpu_count()


class PikafishEngine:
    """Wrapper for the Pikafish UCI engine."""

    def __init__(self, engine_path: str = None):
        if engine_path is None:
            # Default path relative to this file
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            engine_path = os.path.join(base_dir, 'Pikafish', 'src', 'pikafish')

        self.engine_path = engine_path
        self.process: Optional[subprocess.Popen] = None
        self.output_queue = queue.Queue()
        self.reader_thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()
        self._ready = False

    def start(self) -> bool:
        """Start the engine process."""
        try:
            import os
            # Use unbuffered I/O for better subprocess communication
            env = os.environ.copy()
            env['PYTHONUNBUFFERED'] = '1'

            self.process = subprocess.Popen(
                [self.engine_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,  # Ignore stderr to avoid blocking
                text=True,
                bufsize=0,  # Unbuffered
                env=env
            )

            # Start reader thread
            self.reader_thread = threading.Thread(target=self._read_output, daemon=True)
            self.reader_thread.start()

            # Initialize UCI
            self._send("uci")
            self._wait_for("uciok", timeout=5.0)

            self._send("isready")
            self._wait_for("readyok", timeout=5.0)

            self._ready = True
            return True

        except Exception as e:
            print(f"Failed to start Pikafish: {e}")
            return False

    def stop(self):
        """Stop the engine process."""
        if self.process:
            try:
                self._send("quit")
                self.process.terminate()
                self.process.wait(timeout=2)
            except:
                self.process.kill()
            self.process = None
        self._ready = False

    def is_ready(self) -> bool:
        return self._ready and self.process is not None

    def _send(self, cmd: str):
        """Send a command to the engine."""
        if self.process and self.process.stdin:
            self.process.stdin.write(cmd + "\n")
            self.process.stdin.flush()

    def _read_output(self):
        """Background thread to read engine output."""
        while self.process and self.process.stdout:
            try:
                line = self.process.stdout.readline()
                if line:
                    self.output_queue.put(line.strip())
                else:
                    break
            except:
                break

    def _wait_for(self, token: str, timeout: float = 30.0) -> Optional[str]:
        """Wait for a specific token in engine output."""
        import time
        start = time.time()
        while time.time() - start < timeout:
            try:
                line = self.output_queue.get(timeout=0.1)
                if token in line:
                    return line
            except queue.Empty:
                continue
        return None

    def get_best_move(self, moves: list, difficulty: str = 'medium') -> Optional[str]:
        """
        Get the best move for the current position.

        Args:
            moves: List of moves in UCI format (e.g., ['h2e2', 'b9c7'])
            difficulty: Difficulty level ('easy', 'medium', 'hard', 'extreme')

        Returns:
            Best move in UCI format (e.g., 'h0g2') or None if failed
        """
        import logging
        logger = logging.getLogger(__name__)

        if not self.is_ready():
            logger.debug("Engine not ready, starting...")
            if not self.start():
                logger.error("Failed to start engine")
                return None

        with self.lock:
            # Clear output queue
            while not self.output_queue.empty():
                try:
                    self.output_queue.get_nowait()
                except:
                    break

            # Build position command
            pos_cmd = "position startpos"
            if moves:
                pos_cmd += " moves " + " ".join(moves)

            # Get difficulty settings (movetime only)
            movetime = DIFFICULTY_SETTINGS.get(difficulty, 5000)
            go_cmd = f"go movetime {movetime}"

            # Send all commands together quickly (engine timing issue workaround)
            logger.debug(f"Sending: isready + {pos_cmd} + {go_cmd}")
            self.process.stdin.write(f"isready\n{pos_cmd}\n{go_cmd}\n")
            self.process.stdin.flush()

            # Wait for bestmove
            best_move = None
            timeout_seconds = max(movetime / 1000 + 30, 60)  # Increased timeout
            logger.debug(f"Waiting for bestmove (timeout: {timeout_seconds}s)")

            lines_received = []
            while True:
                try:
                    line = self.output_queue.get(timeout=timeout_seconds)
                    lines_received.append(line)
                    if line.startswith("bestmove"):
                        parts = line.split()
                        if len(parts) >= 2:
                            best_move = parts[1]
                            if best_move == "(none)":
                                logger.warning("Engine returned (none) - no legal moves?")
                                best_move = None
                        break
                    elif "info" in line and "score" in line:
                        # Log search progress
                        logger.debug(f"Search: {line[:100]}...")
                except queue.Empty:
                    logger.error(f"Timeout waiting for bestmove. Last lines: {lines_received[-5:] if lines_received else 'none'}")
                    break

            logger.debug(f"Best move: {best_move}")
            return best_move


def board_to_uci_moves(game_state: dict, move_history: list) -> list:
    """
    Convert website move history to UCI move format.

    Website format: [{"from": [row, col], "to": [row, col], ...}, ...]
    UCI format: ['h2e2', 'b9c7', ...]
    """
    uci_moves = []

    for move in move_history:
        from_row, from_col = move['from']
        to_row, to_col = move['to']

        # Convert to UCI: file (a-i) + rank (0-9)
        from_file = chr(ord('a') + from_col)
        to_file = chr(ord('a') + to_col)

        uci_move = f"{from_file}{from_row}{to_file}{to_row}"
        uci_moves.append(uci_move)

    return uci_moves


def uci_move_to_coords(uci_move: str) -> Tuple[int, int, int, int]:
    """
    Convert UCI move to board coordinates.

    UCI format: 'h2e2' (file + rank for from and to)
    Returns: (from_row, from_col, to_row, to_col)
    """
    from_file = uci_move[0]
    from_rank = int(uci_move[1])
    to_file = uci_move[2]
    to_rank = int(uci_move[3])

    from_col = ord(from_file) - ord('a')
    to_col = ord(to_file) - ord('a')

    return (from_rank, from_col, to_rank, to_col)


# Global engine instance (reused across requests)
_engine_instance: Optional[PikafishEngine] = None


def get_engine() -> PikafishEngine:
    """Get or create the global engine instance."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = PikafishEngine()
    return _engine_instance


def get_pikafish_move(move_history: list, difficulty: str = 'pikafish_medium', threads: int = None) -> Optional[dict]:
    """
    Get a move from Pikafish engine using communicate().

    Args:
        move_history: List of moves in website format
        difficulty: Difficulty level
        threads: Number of threads to use (defaults to all system threads)

    Returns:
        Move dict with 'from' and 'to' coordinates, or None if failed
    """
    import logging
    logger = logging.getLogger(__name__)

    # Convert moves to UCI format
    uci_moves = board_to_uci_moves(None, move_history)

    # Build position command
    pos_cmd = "position startpos"
    if uci_moves:
        pos_cmd += " moves " + " ".join(uci_moves)

    # Get settings from difficulty
    settings = DIFFICULTY_SETTINGS.get(difficulty, {'depth': 22, 'movetime': 3000})
    depth = settings['depth']
    movetime = settings['movetime']

    # Use provided threads or default to all system threads
    if threads is None or threads <= 0:
        threads = DEFAULT_THREADS

    # Get engine path
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'Pikafish', 'src', 'pikafish')

    logger.debug(f"Running engine with depth {depth}, movetime {movetime}ms, threads {threads}")
    logger.debug(f"Position: {pos_cmd}")

    # Commands with quit at the end - engine will complete search then exit
    # Set threads before search
    commands = f"uci\nsetoption name Threads value {threads}\nisready\n{pos_cmd}\ngo depth {depth}\nquit\n"

    try:
        # Use Popen with communicate - this sends input and waits for process to exit
        process = subprocess.Popen(
            [engine_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # communicate() sends all input, closes stdin, then waits for exit
        # The quit command ensures clean exit after search completes
        stdout, stderr = process.communicate(input=commands, timeout=60)

        if process.returncode != 0 and process.returncode != -15:  # -15 is SIGTERM
            logger.error(f"Engine exited with code {process.returncode}")
            if stderr:
                logger.error(f"Stderr: {stderr[:200]}")

        # Parse output for bestmove
        best_move = None
        for line in stdout.split('\n'):
            if "info" in line and "depth" in line:
                logger.debug(f"Search: {line[:80]}...")
            if line.startswith('bestmove'):
                parts = line.split()
                if len(parts) >= 2:
                    best_move = parts[1]
                    if best_move == "(none)":
                        best_move = None
                break

        logger.debug(f"Engine returned: {best_move}")

        if not best_move:
            return None

        # Convert back to website format
        from_row, from_col, to_row, to_col = uci_move_to_coords(best_move)

        return {
            'from': {'row': from_row, 'col': from_col},
            'to': {'row': to_row, 'col': to_col}
        }

    except subprocess.TimeoutExpired as e:
        logger.error("Engine timed out")
        if e.stdout:
            # Try to parse any output we got
            for line in e.stdout.split('\n'):
                if line.startswith('bestmove'):
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] != "(none)":
                        from_row, from_col, to_row, to_col = uci_move_to_coords(parts[1])
                        return {
                            'from': {'row': from_row, 'col': from_col},
                            'to': {'row': to_row, 'col': to_col}
                        }
        return None
    except Exception as e:
        logger.error(f"Engine error: {e}")
        return None
