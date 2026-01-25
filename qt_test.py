#!/usr/bin/env python3
"""
Simple Qt interface for testing Pikafish absorption xiangqi engine.
"""

import sys
import subprocess
import os
import re
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QComboBox, QTextEdit, QCheckBox, QLineEdit,
    QMessageBox
)
from PySide6.QtGui import QPainter, QColor, QPen, QFont, QClipboard
from PySide6.QtCore import Qt, QRect, QThread, Signal

# Board dimensions
CELL_SIZE = 60
BOARD_WIDTH = 9
BOARD_HEIGHT = 10
MARGIN = 30

# Piece characters for display
PIECE_CHARS = {
    'r': '車', 'n': '馬', 'b': '相', 'a': '仕', 'k': '帥', 'c': '炮', 'p': '兵',
    'R': '車', 'N': '馬', 'B': '象', 'A': '士', 'K': '將', 'C': '砲', 'P': '卒'
}

# Chinese numerals for Red (file i=一, h=二, ..., a=九)
RED_FILE_CHARS = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
# Arabic numerals for Black (file a=1, b=2, ..., i=9)
BLACK_FILE_CHARS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

def uci_to_chinese(uci_move, board):
    """Convert UCI move to Chinese notation given current board state.

    Args:
        uci_move: UCI format like 'h2e2'
        board: 2D list of pieces (board[row][col])

    Returns:
        Chinese notation string like '炮二平五'
    """
    if len(uci_move) < 4:
        return uci_move

    from_col = ord(uci_move[0]) - ord('a')
    from_rank = int(uci_move[1])
    to_col = ord(uci_move[2]) - ord('a')
    to_rank = int(uci_move[3])

    # Convert UCI rank to board row (invert)
    from_row = 9 - from_rank
    to_row = 9 - to_rank

    if not (0 <= from_row < 10 and 0 <= from_col < 9):
        return uci_move

    piece = board[from_row][from_col]
    if piece == '.':
        return uci_move

    is_red = piece.isupper()
    piece_char = PIECE_CHARS.get(piece, piece)

    # File numbers (from player's perspective, right to left)
    if is_red:
        from_file_char = RED_FILE_CHARS[from_col]
        to_file_char = RED_FILE_CHARS[to_col]
    else:
        from_file_char = BLACK_FILE_CHARS[from_col]
        to_file_char = BLACK_FILE_CHARS[to_col]

    # Determine movement type
    if from_col == to_col:
        # Vertical movement (進/退)
        distance = abs(to_rank - from_rank)
        if is_red:
            dist_char = RED_FILE_CHARS[9 - distance] if distance <= 9 else str(distance)
            action = '進' if to_rank > from_rank else '退'
        else:
            dist_char = BLACK_FILE_CHARS[distance - 1] if distance <= 9 else str(distance)
            action = '進' if to_rank < from_rank else '退'
        return f"{piece_char}{from_file_char}{action}{dist_char}"
    elif from_row == to_row:
        # Horizontal movement (平)
        return f"{piece_char}{from_file_char}平{to_file_char}"
    else:
        # Diagonal movement (Knight, Bishop, Advisor) - use destination file
        if is_red:
            action = '進' if to_rank > from_rank else '退'
        else:
            action = '進' if to_rank < from_rank else '退'
        return f"{piece_char}{from_file_char}{action}{to_file_char}"

# Initial board setup (FEN-like, red at bottom)
INITIAL_BOARD = [
    ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'],
    ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ['.', 'c', '.', '.', '.', '.', '.', 'c', '.'],
    ['p', '.', 'p', '.', 'p', '.', 'p', '.', 'p'],
    ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ['P', '.', 'P', '.', 'P', '.', 'P', '.', 'P'],
    ['.', 'C', '.', '.', '.', '.', '.', 'C', '.'],
    ['.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'],
]


import multiprocessing
DEFAULT_THREADS = multiprocessing.cpu_count()


class EngineWorker(QThread):
    """Persistent engine worker that keeps the process alive."""
    move_ready = Signal(str)
    search_info = Signal(str)
    ready = Signal()

    def __init__(self, engine_path):
        super().__init__()
        self.engine_path = engine_path
        self.process = None
        self.output_lines = []
        self.waiting_for_bestmove = False
        self.current_moves = []
        self.current_depth = 30
        self.current_threads = DEFAULT_THREADS
        self._running = True

    def run(self):
        """Main thread loop - reads engine output."""
        # Start engine process
        self.process = subprocess.Popen(
            [self.engine_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1
        )

        # Initialize UCI
        self._send("uci")
        self._wait_for("uciok")
        self._send("isready")
        self._wait_for("readyok")
        self.ready.emit()

        # Main read loop
        while self._running:
            if not self.process or self.process.poll() is not None:
                # Engine crashed or exited, restart it
                if self.waiting_for_bestmove:
                    self.search_info.emit("Engine crashed, restarting...")
                    self.move_ready.emit("")
                    self.waiting_for_bestmove = False
                self._restart_engine()
                continue

            try:
                line = self.process.stdout.readline()
                if not line:
                    # Engine crashed, signal failure and restart
                    if self.waiting_for_bestmove:
                        self.search_info.emit("Engine crashed, restarting...")
                        self.move_ready.emit("")
                        self.waiting_for_bestmove = False
                    continue
                line = line.strip()

                # Skip readyok lines (from sync commands)
                if line == "readyok":
                    continue

                # Debug: show all lines when waiting for bestmove
                if self.waiting_for_bestmove:
                    print(f"[Engine] {line[:70]}")

                if "info" in line and "depth" in line and "score" in line:
                    self.search_info.emit(line)

                if line.startswith("bestmove"):
                    print(f"[Engine] GOT: {line}")
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] != "(none)":
                        self.move_ready.emit(parts[1])
                    else:
                        self.move_ready.emit("")
                    self.waiting_for_bestmove = False

            except Exception as e:
                self.search_info.emit(f"Read error: {e}")
                continue

    def _send(self, cmd):
        """Send command to engine."""
        if self.process and self.process.stdin:
            self.process.stdin.write(cmd + "\n")
            self.process.stdin.flush()

    def _wait_for(self, token, timeout=10):
        """Wait for a specific response."""
        import time
        start = time.time()
        while time.time() - start < timeout:
            line = self.process.stdout.readline()
            if not line:  # EOF
                return False
            if token in line:
                return True
        return False

    def search(self, moves, depth, movetime_ms, fen=None, threads=None):
        """Start a new search with both depth and time limits.

        If fen is provided, use it directly (for loaded positions with absorption).
        Otherwise use startpos + moves.
        """
        # Set threads if specified
        if threads is not None and threads > 0:
            self._send(f"setoption name Threads value {threads}")
            self.current_threads = threads

        # Ensure engine is synced before sending new position
        self._send("isready")

        if fen:
            pos_cmd = f"position fen {fen}"
        else:
            pos_cmd = "position startpos"
            if moves:
                pos_cmd += " moves " + " ".join(moves)

        print(f"[Search] threads={self.current_threads} {pos_cmd}")
        print(f"[Search] go depth {depth} movetime {movetime_ms}")
        self._send(pos_cmd)
        self._send(f"go depth {depth} movetime {movetime_ms}")
        self.waiting_for_bestmove = True

    def _restart_engine(self):
        """Restart the engine after a crash."""
        import time
        if self.process:
            try:
                self.process.kill()
            except:
                pass
            self.process = None

        time.sleep(0.1)

        self.process = subprocess.Popen(
            [self.engine_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1
        )

        self._send("uci")
        self._wait_for("uciok")
        self._send("isready")
        self._wait_for("readyok")

    def stop_engine(self):
        """Stop the engine gracefully."""
        self._running = False
        if self.process:
            try:
                self._send("quit")
                self.process.terminate()
            except:
                pass


class BoardWidget(QWidget):
    """Widget to display and interact with the xiangqi board."""
    move_made = Signal()  # Emitted when a move is made
    fen_changed = Signal(str)  # Emitted when position changes, with new FEN

    def __init__(self, parent=None):
        super().__init__(parent)
        self.board = [row[:] for row in INITIAL_BOARD]
        # Absorption tracking: absorbed[row][col] = string of absorbed piece types (e.g., "cn" for cannon+knight)
        self.absorbed = [['' for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]
        self.selected = None
        self.moves = []  # UCI move history
        self.red_turn = True
        self.setMinimumSize(
            BOARD_WIDTH * CELL_SIZE + 2 * MARGIN,
            BOARD_HEIGHT * CELL_SIZE + 2 * MARGIN
        )

    def reset(self):
        self.board = [row[:] for row in INITIAL_BOARD]
        self.absorbed = [['' for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]
        self.selected = None
        self.moves = []
        self.red_turn = True
        self.update()
        self.fen_changed.emit(self.get_fen())

    def get_fen(self):
        """Generate FEN string with extended absorption notation."""
        fen_rows = []
        for row in range(BOARD_HEIGHT):
            fen_row = ''
            empty_count = 0
            for col in range(BOARD_WIDTH):
                piece = self.board[row][col]
                if piece == '.':
                    empty_count += 1
                else:
                    if empty_count > 0:
                        fen_row += str(empty_count)
                        empty_count = 0
                    fen_row += piece
                    # Add absorption info if any
                    if self.absorbed[row][col]:
                        fen_row += f'({self.absorbed[row][col]})'
            if empty_count > 0:
                fen_row += str(empty_count)
            fen_rows.append(fen_row)

        board_fen = '/'.join(fen_rows)
        turn = 'w' if self.red_turn else 'b'
        return f"{board_fen} {turn} - - 0 1"

    def set_fen(self, fen):
        """Parse FEN string with extended absorption notation and set board state."""
        # Reset board
        self.board = [['.' for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]
        self.absorbed = [['' for _ in range(BOARD_WIDTH)] for _ in range(BOARD_HEIGHT)]
        self.moves = []

        parts = fen.split()
        board_part = parts[0]

        # Parse turn
        if len(parts) > 1:
            self.red_turn = (parts[1] == 'w')
        else:
            self.red_turn = True

        # Parse board with absorption notation
        # Pattern: piece possibly followed by (abilities)
        row = 0
        col = 0
        i = 0
        while i < len(board_part) and row < BOARD_HEIGHT:
            c = board_part[i]
            if c == '/':
                row += 1
                col = 0
            elif c.isdigit():
                col += int(c)
            elif c in 'rnbakcp' or c in 'RNBAKCP':
                if col < BOARD_WIDTH:
                    self.board[row][col] = c
                    # Check for absorption notation
                    if i + 1 < len(board_part) and board_part[i + 1] == '(':
                        # Find closing paren
                        end = board_part.find(')', i + 2)
                        if end != -1:
                            abilities = board_part[i + 2:end]
                            self.absorbed[row][col] = abilities
                            i = end  # Skip to closing paren
                    col += 1
            i += 1

        self.selected = None
        self.update()
        self.fen_changed.emit(self.get_fen())

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Draw board background
        painter.fillRect(self.rect(), QColor(240, 217, 181))

        # Draw grid lines
        pen = QPen(QColor(0, 0, 0), 2)
        painter.setPen(pen)

        for i in range(BOARD_HEIGHT):
            y = MARGIN + i * CELL_SIZE
            painter.drawLine(MARGIN, y, MARGIN + (BOARD_WIDTH - 1) * CELL_SIZE, y)

        for j in range(BOARD_WIDTH):
            x = MARGIN + j * CELL_SIZE
            # River gap
            painter.drawLine(x, MARGIN, x, MARGIN + 4 * CELL_SIZE)
            painter.drawLine(x, MARGIN + 5 * CELL_SIZE, x, MARGIN + 9 * CELL_SIZE)

        # Draw palace diagonals
        painter.drawLine(MARGIN + 3 * CELL_SIZE, MARGIN, MARGIN + 5 * CELL_SIZE, MARGIN + 2 * CELL_SIZE)
        painter.drawLine(MARGIN + 5 * CELL_SIZE, MARGIN, MARGIN + 3 * CELL_SIZE, MARGIN + 2 * CELL_SIZE)
        painter.drawLine(MARGIN + 3 * CELL_SIZE, MARGIN + 7 * CELL_SIZE, MARGIN + 5 * CELL_SIZE, MARGIN + 9 * CELL_SIZE)
        painter.drawLine(MARGIN + 5 * CELL_SIZE, MARGIN + 7 * CELL_SIZE, MARGIN + 3 * CELL_SIZE, MARGIN + 9 * CELL_SIZE)

        # Draw river text
        font = QFont("Arial", 16)
        painter.setFont(font)
        painter.drawText(MARGIN + CELL_SIZE, MARGIN + 4 * CELL_SIZE + 35, "楚 河")
        painter.drawText(MARGIN + 5 * CELL_SIZE, MARGIN + 4 * CELL_SIZE + 35, "漢 界")

        # Draw pieces
        font = QFont("Arial", 28, QFont.Bold)
        painter.setFont(font)

        for row in range(BOARD_HEIGHT):
            for col in range(BOARD_WIDTH):
                piece = self.board[row][col]
                if piece != '.':
                    x = MARGIN + col * CELL_SIZE
                    y = MARGIN + row * CELL_SIZE

                    # Piece background circle
                    is_red = piece.isupper()
                    has_absorbed = bool(self.absorbed[row][col])

                    if self.selected == (row, col):
                        painter.setBrush(QColor(255, 255, 0))  # Selected
                    elif has_absorbed:
                        painter.setBrush(QColor(200, 255, 200))  # Green tint for absorbed abilities
                    else:
                        painter.setBrush(QColor(255, 235, 205))

                    # Thicker border if has absorbed abilities
                    border_width = 3 if has_absorbed else 2
                    painter.setPen(QPen(QColor(0, 128, 0) if has_absorbed else QColor(139, 69, 19), border_width))
                    painter.drawEllipse(x - 25, y - 25, 50, 50)

                    # Piece text
                    painter.setPen(QColor(200, 0, 0) if is_red else QColor(0, 0, 0))
                    char = PIECE_CHARS.get(piece, piece)
                    painter.drawText(QRect(x - 25, y - 25, 50, 50), Qt.AlignCenter, char)

                    # Draw absorbed abilities indicator
                    if has_absorbed:
                        small_font = QFont("Arial", 8)
                        painter.setFont(small_font)
                        painter.setPen(QColor(0, 100, 0))
                        painter.drawText(QRect(x - 25, y + 15, 50, 15), Qt.AlignCenter,
                                        f"+{self.absorbed[row][col].upper()}")
                        painter.setFont(font)

    def mousePressEvent(self, event):
        pos = event.position()
        x = int(pos.x())
        y = int(pos.y())

        # Convert to board coordinates
        col = round((x - MARGIN) / CELL_SIZE)
        row = round((y - MARGIN) / CELL_SIZE)

        # Debug: show clicked square
        if 0 <= row < BOARD_HEIGHT and 0 <= col < BOARD_WIDTH:
            file_char = chr(ord('a') + col)
            rank = 9 - row
            print(f"[Click] row={row} col={col} -> UCI: {file_char}{rank}")

        if 0 <= row < BOARD_HEIGHT and 0 <= col < BOARD_WIDTH:
            piece = self.board[row][col]

            if self.selected is None:
                # Select a piece
                if piece != '.':
                    is_red = piece.isupper()
                    if is_red == self.red_turn:
                        self.selected = (row, col)
                        self.update()
            else:
                # Try to move
                from_row, from_col = self.selected
                if (row, col) == self.selected:
                    # Deselect
                    self.selected = None
                else:
                    # Make move (no validation for simplicity)
                    self.make_move(from_row, from_col, row, col)
                    self.selected = None
                self.update()

    def make_move(self, from_row, from_col, to_row, to_col, emit_signal=True):
        """Make a move on the board with absorption mechanics."""
        piece = self.board[from_row][from_col]
        captured = self.board[to_row][to_col]

        # Handle absorption: when capturing, absorb the captured piece's type
        if captured != '.':
            captured_type = captured.lower()
            moving_type = piece.lower()
            # Don't absorb: kings, same piece type, or already absorbed type
            if captured_type not in ('k', moving_type) and captured_type not in self.absorbed[from_row][from_col]:
                self.absorbed[from_row][from_col] += captured_type
                print(f"[Absorption] {piece} absorbs {captured_type} ability")

        # Move the piece
        self.board[to_row][to_col] = piece
        self.board[from_row][from_col] = '.'

        # Move absorbed abilities with the piece
        self.absorbed[to_row][to_col] = self.absorbed[from_row][from_col]
        self.absorbed[from_row][from_col] = ''

        # Record UCI move
        # UCI rank: 0 = bottom (Red's back rank), 9 = top (Black's back rank)
        # Board row: 0 = top (Black's back rank), 9 = bottom (Red's back rank)
        from_file = chr(ord('a') + from_col)
        to_file = chr(ord('a') + to_col)
        from_rank = 9 - from_row  # Convert board row to UCI rank
        to_rank = 9 - to_row
        uci_move = f"{from_file}{from_rank}{to_file}{to_rank}"
        self.moves.append(uci_move)

        # Print move for debugging
        cap_str = f" captures {captured}" if captured != '.' else ""
        absorbed_str = f" (has: +{self.absorbed[to_row][to_col].upper()})" if self.absorbed[to_row][to_col] else ""
        print(f"[Move {len(self.moves)}] {piece} {uci_move}{cap_str}{absorbed_str}")

        self.red_turn = not self.red_turn
        self.update()

        if emit_signal:
            self.move_made.emit()
            self.fen_changed.emit(self.get_fen())

    def apply_uci_move(self, uci_move):
        """Apply a UCI move to the board (engine move, no signal)."""
        from_col = ord(uci_move[0]) - ord('a')
        from_rank = int(uci_move[1])
        to_col = ord(uci_move[2]) - ord('a')
        to_rank = int(uci_move[3])
        # Convert UCI rank to board row (invert)
        from_row = 9 - from_rank
        to_row = 9 - to_rank
        self.make_move(from_row, from_col, to_row, to_col, emit_signal=False)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Absorption Xiangqi - Pikafish Test")

        # Engine path
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.engine_path = os.path.join(base_dir, 'Pikafish', 'src', 'pikafish')

        # Start persistent engine worker
        self.engine_worker = EngineWorker(self.engine_path)
        self.engine_worker.move_ready.connect(self.on_engine_move)
        self.engine_worker.search_info.connect(self.on_search_info)
        self.engine_worker.ready.connect(self.on_engine_ready)
        self.engine_worker.start()
        self.engine_ready = False

        # Main widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)

        # Top section: board + right panel
        top_layout = QHBoxLayout()
        main_layout.addLayout(top_layout)

        # Board
        self.board_widget = BoardWidget()
        self.board_widget.move_made.connect(self.on_player_move)
        top_layout.addWidget(self.board_widget)

        # Right panel
        right_panel = QVBoxLayout()
        top_layout.addLayout(right_panel)

        # Status label
        self.status_label = QLabel("Starting engine...")
        self.status_label.setFont(QFont("Arial", 14))
        right_panel.addWidget(self.status_label)

        # Threads selector (default to all system threads)
        threads_layout = QHBoxLayout()
        threads_layout.addWidget(QLabel("Threads:"))
        self.threads_combo = QComboBox()
        thread_options = [str(i) for i in range(1, DEFAULT_THREADS + 1)]
        self.threads_combo.addItems(thread_options)
        self.threads_combo.setCurrentText(str(DEFAULT_THREADS))  # Default to all threads
        threads_layout.addWidget(self.threads_combo)
        right_panel.addLayout(threads_layout)

        # Depth selector (min 20)
        depth_layout = QHBoxLayout()
        depth_layout.addWidget(QLabel("Depth:"))
        self.depth_combo = QComboBox()
        self.depth_combo.addItems(['20', '22', '24', '26', '28', '30', '32'])
        self.depth_combo.setCurrentText('30')
        depth_layout.addWidget(self.depth_combo)
        right_panel.addLayout(depth_layout)

        # Time selector (default 3 seconds)
        time_layout = QHBoxLayout()
        time_layout.addWidget(QLabel("Time (sec):"))
        self.time_combo = QComboBox()
        self.time_combo.addItems(['3', '5', '10', '15', '30', '60'])
        self.time_combo.setCurrentText('3')  # Default to 3 seconds
        time_layout.addWidget(self.time_combo)
        right_panel.addLayout(time_layout)

        # Auto-play checkbox
        self.auto_play_black = QCheckBox("Engine plays Black")
        self.auto_play_black.setChecked(True)
        right_panel.addWidget(self.auto_play_black)

        self.auto_play_red = QCheckBox("Engine plays Red")
        self.auto_play_red.setChecked(False)
        right_panel.addWidget(self.auto_play_red)

        # Buttons
        self.engine_btn = QPushButton("Get Engine Move")
        self.engine_btn.clicked.connect(self.get_engine_move)
        self.engine_btn.setEnabled(False)  # Disabled until engine is ready
        right_panel.addWidget(self.engine_btn)

        self.reset_btn = QPushButton("Reset Board")
        self.reset_btn.clicked.connect(self.reset_game)
        right_panel.addWidget(self.reset_btn)

        # FEN display and copy/paste
        right_panel.addWidget(QLabel("Position FEN (with absorption):"))
        self.fen_input = QLineEdit()
        self.fen_input.setPlaceholderText("FEN will appear here...")
        right_panel.addWidget(self.fen_input)

        fen_btn_layout = QHBoxLayout()
        self.copy_fen_btn = QPushButton("Copy FEN")
        self.copy_fen_btn.clicked.connect(self.copy_fen)
        fen_btn_layout.addWidget(self.copy_fen_btn)

        self.paste_fen_btn = QPushButton("Load FEN")
        self.paste_fen_btn.clicked.connect(self.load_fen)
        fen_btn_layout.addWidget(self.paste_fen_btn)
        right_panel.addLayout(fen_btn_layout)

        # Connect FEN change signal
        self.board_widget.fen_changed.connect(self.on_fen_changed)

        # Log area
        right_panel.addWidget(QLabel("Engine Output:"))
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setMaximumHeight(300)
        right_panel.addWidget(self.log_text)

        # Move history
        right_panel.addWidget(QLabel("Move History:"))
        self.history_text = QTextEdit()
        self.history_text.setReadOnly(True)
        self.history_text.setMaximumHeight(100)
        right_panel.addWidget(self.history_text)

        right_panel.addStretch()

        # Engine thinking line (PV) - below the board, full width
        pv_section = QHBoxLayout()
        pv_section.addWidget(QLabel("思考線:"))
        self.pv_label = QLabel("")
        self.pv_label.setFont(QFont("PingFang SC", 16, QFont.Bold))
        self.pv_label.setWordWrap(True)
        self.pv_label.setStyleSheet(
            "QLabel { background-color: #fffde7; color: #333; padding: 8px; border: 2px solid #fbc02d; border-radius: 4px; }"
        )
        self.pv_label.setMinimumHeight(50)
        pv_section.addWidget(self.pv_label, 1)  # stretch factor 1 to take remaining space
        main_layout.addLayout(pv_section)

    def on_engine_ready(self):
        self.engine_ready = True
        self.status_label.setText("Engine ready. Red to move.")
        self.engine_btn.setEnabled(True)
        # If engine plays red, start automatically
        if self.auto_play_red.isChecked():
            self.get_engine_move()

    def on_player_move(self):
        """Called when a player makes a move."""
        self.update_status()
        self.update_history()
        # Auto-play if enabled for current side
        if self.board_widget.red_turn and self.auto_play_red.isChecked():
            self.get_engine_move()
        elif not self.board_widget.red_turn and self.auto_play_black.isChecked():
            self.get_engine_move()

    def get_engine_move(self):
        if not self.engine_ready or self.engine_worker.waiting_for_bestmove:
            return

        threads = int(self.threads_combo.currentText())
        depth = int(self.depth_combo.currentText())
        time_sec = int(self.time_combo.currentText())
        movetime_ms = time_sec * 1000

        self.status_label.setText(f"Engine thinking ({threads} threads, depth {depth}, {time_sec}s max)...")
        self.engine_btn.setEnabled(False)
        self.log_text.clear()
        self.pv_label.setText("計算中...")

        # Always use FEN to preserve absorption state
        fen = self.board_widget.get_fen()
        self.engine_worker.search(self.board_widget.moves, depth, movetime_ms, fen=fen, threads=threads)

    def on_search_info(self, info):
        # Extract key info
        if "depth" in info and "score" in info:
            parts = info.split()
            try:
                depth_idx = parts.index("depth")
                score_idx = parts.index("score")
                depth = parts[depth_idx + 1]
                score_type = parts[score_idx + 1]
                score_val = parts[score_idx + 2]
                self.log_text.append(f"depth {depth}: {score_type} {score_val}")

                # Extract and display PV line in Chinese notation
                if "pv" in parts:
                    pv_idx = parts.index("pv")
                    pv_moves = parts[pv_idx + 1:]  # All moves after "pv"
                    print(f"[PV] depth {depth}: {' '.join(pv_moves[:5])}")

                    # Convert to Chinese notation by simulating moves
                    chinese_moves = []
                    # Make a copy of the board to simulate moves
                    sim_board = [row[:] for row in self.board_widget.board]

                    for uci_move in pv_moves[:8]:  # Show up to 8 moves
                        chinese = uci_to_chinese(uci_move, sim_board)
                        chinese_moves.append(chinese)
                        # Apply move to simulated board
                        if len(uci_move) >= 4:
                            fc = ord(uci_move[0]) - ord('a')
                            fr = 9 - int(uci_move[1])
                            tc = ord(uci_move[2]) - ord('a')
                            tr = 9 - int(uci_move[3])
                            if 0 <= fr < 10 and 0 <= fc < 9 and 0 <= tr < 10 and 0 <= tc < 9:
                                sim_board[tr][tc] = sim_board[fr][fc]
                                sim_board[fr][fc] = '.'

                    pv_str = " ".join(chinese_moves)
                    if len(pv_moves) > 8:
                        pv_str += " ..."

                    # Format score nicely
                    if score_type == "cp":
                        score_display = f"{int(score_val)/100:+.2f}"
                    else:
                        score_display = f"M{score_val}"

                    self.pv_label.setText(f"深度{depth} [{score_display}]: {pv_str}")
            except:
                self.log_text.append(info[:80])

    def on_engine_move(self, move):
        self.engine_btn.setEnabled(True)

        if move:
            self.log_text.append(f"\nBest move: {move}")
            # Convert bestmove to Chinese and update PV label
            chinese_move = uci_to_chinese(move, self.board_widget.board)
            current_pv = self.pv_label.text()
            self.pv_label.setText(f"最佳: {chinese_move} ({move}) | {current_pv}")
            print(f"[UI] Applying bestmove: {move} -> {chinese_move}")
            self.board_widget.apply_uci_move(move)
            self.update_status()
            self.update_history()
            # Update FEN display after engine move
            self.fen_input.setText(self.board_widget.get_fen())
        else:
            self.status_label.setText("Engine failed - try lower depth")

    def update_status(self):
        turn = "Red" if self.board_widget.red_turn else "Black"
        self.status_label.setText(f"{turn} to move")

    def update_history(self):
        moves = self.board_widget.moves
        text = " ".join(f"{i+1}.{m}" for i, m in enumerate(moves))
        self.history_text.setText(text)

    def reset_game(self):
        self.board_widget.reset()
        self.status_label.setText("Red to move")
        self.log_text.clear()
        self.history_text.clear()
        self.pv_label.setText("")
        self.fen_input.setText(self.board_widget.get_fen())

    def on_fen_changed(self, fen):
        """Update FEN display when position changes."""
        self.fen_input.setText(fen)

    def copy_fen(self):
        """Copy current FEN to clipboard."""
        fen = self.board_widget.get_fen()
        clipboard = QApplication.clipboard()
        clipboard.setText(fen)
        self.status_label.setText("FEN copied to clipboard!")

    def load_fen(self):
        """Load position from FEN in input field."""
        fen = self.fen_input.text().strip()
        if not fen:
            # Try to get from clipboard
            clipboard = QApplication.clipboard()
            fen = clipboard.text().strip()
            if fen:
                self.fen_input.setText(fen)

        if not fen:
            QMessageBox.warning(self, "No FEN", "Please enter a FEN string or copy one to clipboard.")
            return

        try:
            self.board_widget.set_fen(fen)
            self.update_status()
            self.history_text.clear()
            self.log_text.clear()
            self.status_label.setText(f"Position loaded. {'Red' if self.board_widget.red_turn else 'Black'} to move.")
        except Exception as e:
            QMessageBox.warning(self, "Invalid FEN", f"Could not parse FEN: {e}")

    def closeEvent(self, event):
        """Clean up engine when window closes."""
        if self.engine_worker:
            self.engine_worker.stop_engine()
            self.engine_worker.wait(2000)
        event.accept()


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
