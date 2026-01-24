"""
Data models for Absorption Xiangqi (功能棋)
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import uuid


class PieceType(Enum):
    """Types of pieces in Xiangqi"""
    GENERAL = "general"      # 將/帥
    ADVISOR = "advisor"      # 士
    ELEPHANT = "elephant"    # 象/相
    HORSE = "horse"          # 馬
    CHARIOT = "chariot"      # 車
    CANNON = "cannon"        # 炮
    SOLDIER = "soldier"      # 卒/兵


class Color(Enum):
    """Player colors"""
    RED = "red"
    BLACK = "black"


class GameState(Enum):
    """Game state"""
    WAITING = "waiting"      # Waiting for second player
    PLAYING = "playing"      # Game in progress
    RED_WIN = "red_win"      # Red wins
    BLACK_WIN = "black_win"  # Black wins
    DRAW = "draw"            # Draw


@dataclass
class Piece:
    """A piece on the board"""
    piece_type: PieceType
    color: Color
    row: int  # 0-9, 0 is red's back row
    col: int  # 0-8, 0 is left from red's perspective
    acquired_abilities: set = field(default_factory=set)

    def to_dict(self) -> dict:
        return {
            "type": self.piece_type.value,
            "color": self.color.value,
            "row": self.row,
            "col": self.col,
            "abilities": [a.value for a in self.acquired_abilities]
        }

    def has_ability(self, piece_type: PieceType) -> bool:
        """Check if this piece can move as the given type"""
        return self.piece_type == piece_type or piece_type in self.acquired_abilities

    def is_full_board(self) -> bool:
        """Check if this piece can move anywhere on the board"""
        # General always stays in palace
        if self.piece_type == PieceType.GENERAL:
            return False
        # If piece has any acquired abilities, it becomes full board
        # Exception: if advisor captures advisor or elephant captures elephant,
        # no new ability gained, so it stays restricted
        if self.acquired_abilities:
            return True
        # Default full board pieces
        return self.piece_type in (
            PieceType.CHARIOT, PieceType.HORSE,
            PieceType.CANNON, PieceType.SOLDIER
        )


@dataclass
class Board:
    """The game board (10 rows x 9 columns)"""
    pieces: list = field(default_factory=list)

    def __post_init__(self):
        if not self.pieces:
            self._setup_initial_position()

    def _setup_initial_position(self):
        """Set up the initial piece positions"""
        self.pieces = []

        # Red pieces (bottom, rows 0-4)
        # Back row (row 0)
        self.pieces.append(Piece(PieceType.CHARIOT, Color.RED, 0, 0))
        self.pieces.append(Piece(PieceType.HORSE, Color.RED, 0, 1))
        self.pieces.append(Piece(PieceType.ELEPHANT, Color.RED, 0, 2))
        self.pieces.append(Piece(PieceType.ADVISOR, Color.RED, 0, 3))
        self.pieces.append(Piece(PieceType.GENERAL, Color.RED, 0, 4))
        self.pieces.append(Piece(PieceType.ADVISOR, Color.RED, 0, 5))
        self.pieces.append(Piece(PieceType.ELEPHANT, Color.RED, 0, 6))
        self.pieces.append(Piece(PieceType.HORSE, Color.RED, 0, 7))
        self.pieces.append(Piece(PieceType.CHARIOT, Color.RED, 0, 8))

        # Cannons (row 2)
        self.pieces.append(Piece(PieceType.CANNON, Color.RED, 2, 1))
        self.pieces.append(Piece(PieceType.CANNON, Color.RED, 2, 7))

        # Soldiers (row 3)
        for col in [0, 2, 4, 6, 8]:
            self.pieces.append(Piece(PieceType.SOLDIER, Color.RED, 3, col))

        # Black pieces (top, rows 5-9)
        # Back row (row 9)
        self.pieces.append(Piece(PieceType.CHARIOT, Color.BLACK, 9, 0))
        self.pieces.append(Piece(PieceType.HORSE, Color.BLACK, 9, 1))
        self.pieces.append(Piece(PieceType.ELEPHANT, Color.BLACK, 9, 2))
        self.pieces.append(Piece(PieceType.ADVISOR, Color.BLACK, 9, 3))
        self.pieces.append(Piece(PieceType.GENERAL, Color.BLACK, 9, 4))
        self.pieces.append(Piece(PieceType.ADVISOR, Color.BLACK, 9, 5))
        self.pieces.append(Piece(PieceType.ELEPHANT, Color.BLACK, 9, 6))
        self.pieces.append(Piece(PieceType.HORSE, Color.BLACK, 9, 7))
        self.pieces.append(Piece(PieceType.CHARIOT, Color.BLACK, 9, 8))

        # Cannons (row 7)
        self.pieces.append(Piece(PieceType.CANNON, Color.BLACK, 7, 1))
        self.pieces.append(Piece(PieceType.CANNON, Color.BLACK, 7, 7))

        # Soldiers (row 6)
        for col in [0, 2, 4, 6, 8]:
            self.pieces.append(Piece(PieceType.SOLDIER, Color.BLACK, 6, col))

    def get_piece_at(self, row: int, col: int) -> Optional[Piece]:
        """Get the piece at a given position"""
        for piece in self.pieces:
            if piece.row == row and piece.col == col:
                return piece
        return None

    def remove_piece(self, piece: Piece):
        """Remove a piece from the board"""
        self.pieces.remove(piece)

    def to_dict(self) -> dict:
        return {
            "pieces": [p.to_dict() for p in self.pieces]
        }


@dataclass
class Game:
    """A game instance"""
    game_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    room_code: str = ""
    board: Board = field(default_factory=Board)
    current_turn: Color = Color.RED
    state: GameState = GameState.WAITING
    red_player_id: Optional[str] = None
    black_player_id: Optional[str] = None
    move_history: list = field(default_factory=list)
    draw_offer_from: Optional[str] = None  # Player ID who offered draw
    rematch_accepted: set = field(default_factory=set)  # Player IDs who accepted rematch

    def to_dict(self) -> dict:
        return {
            "game_id": self.game_id,
            "room_code": self.room_code,
            "board": self.board.to_dict(),
            "current_turn": self.current_turn.value,
            "state": self.state.value,
            "red_player_id": self.red_player_id,
            "black_player_id": self.black_player_id,
            "move_history": self.move_history,
            "draw_offer_from": self.draw_offer_from,
            "rematch_accepted": list(self.rematch_accepted)
        }

    def reset_for_rematch(self):
        """Reset the game for a rematch with swapped sides"""
        # Swap player sides
        self.red_player_id, self.black_player_id = self.black_player_id, self.red_player_id
        # Reset board
        self.board = Board()
        self.current_turn = Color.RED
        self.state = GameState.PLAYING
        self.move_history = []
        self.draw_offer_from = None
        self.rematch_accepted = set()
