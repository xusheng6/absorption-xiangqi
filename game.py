"""
Game logic for Absorption Xiangqi (功能棋)
"""

from models import Piece, PieceType, Color, Board, Game, GameState
from typing import List, Tuple, Optional


def get_valid_moves(game: Game, piece: Piece) -> List[Tuple[int, int]]:
    """Get all valid moves for a piece"""
    moves = []

    # Collect moves from all abilities (default + acquired)
    all_types = {piece.piece_type} | piece.acquired_abilities

    for ptype in all_types:
        type_moves = _get_moves_for_type(game.board, piece, ptype)
        moves.extend(type_moves)

    # Remove duplicates
    moves = list(set(moves))

    # Filter moves that would put own king in check
    valid_moves = []
    for move in moves:
        if not _would_be_in_check(game, piece, move):
            valid_moves.append(move)

    return valid_moves


def _get_moves_for_type(board: Board, piece: Piece, move_type: PieceType) -> List[Tuple[int, int]]:
    """Get moves for a piece moving as a specific type"""
    moves = []

    if move_type == PieceType.GENERAL:
        moves = _get_general_moves(board, piece)
    elif move_type == PieceType.ADVISOR:
        moves = _get_advisor_moves(board, piece)
    elif move_type == PieceType.ELEPHANT:
        moves = _get_elephant_moves(board, piece)
    elif move_type == PieceType.HORSE:
        moves = _get_horse_moves(board, piece)
    elif move_type == PieceType.CHARIOT:
        moves = _get_chariot_moves(board, piece)
    elif move_type == PieceType.CANNON:
        moves = _get_cannon_moves(board, piece)
    elif move_type == PieceType.SOLDIER:
        moves = _get_soldier_moves(board, piece)

    # Filter by movement range
    filtered_moves = []
    for row, col in moves:
        if _is_valid_position(piece, row, col):
            # Can't capture own pieces
            target = board.get_piece_at(row, col)
            if target is None or target.color != piece.color:
                filtered_moves.append((row, col))

    return filtered_moves


def _is_valid_position(piece: Piece, row: int, col: int) -> bool:
    """Check if a position is valid for this piece's movement range"""
    # Basic bounds check
    if not (0 <= row <= 9 and 0 <= col <= 8):
        return False

    # General always restricted to palace
    if piece.piece_type == PieceType.GENERAL:
        return _in_palace(piece.color, row, col)

    # Full board pieces can go anywhere
    if piece.is_full_board():
        return True

    # Restricted pieces (advisor without abilities, elephant without abilities)
    if piece.piece_type == PieceType.ADVISOR:
        return _in_palace(piece.color, row, col)
    if piece.piece_type == PieceType.ELEPHANT:
        return _in_own_half(piece.color, row)

    return True


def _in_palace(color: Color, row: int, col: int) -> bool:
    """Check if position is in the palace"""
    if col < 3 or col > 5:
        return False
    if color == Color.RED:
        return 0 <= row <= 2
    else:
        return 7 <= row <= 9


def _in_own_half(color: Color, row: int) -> bool:
    """Check if row is in own half of the board"""
    if color == Color.RED:
        return row <= 4
    else:
        return row >= 5


def _get_general_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """General moves one step orthogonally within palace"""
    moves = []
    for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        new_row, new_col = piece.row + dr, piece.col + dc
        if _in_palace(piece.color, new_row, new_col):
            moves.append((new_row, new_col))
    return moves


def _get_advisor_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Advisor moves one step diagonally"""
    moves = []
    for dr, dc in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        new_row, new_col = piece.row + dr, piece.col + dc
        # Advisor's default move is diagonal within palace, but if piece has
        # acquired abilities and is full board, it can move diagonally anywhere
        if 0 <= new_row <= 9 and 0 <= new_col <= 8:
            moves.append((new_row, new_col))
    return moves


def _get_elephant_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Elephant moves two steps diagonally if not blocked"""
    moves = []
    for dr, dc in [(2, 2), (2, -2), (-2, 2), (-2, -2)]:
        new_row, new_col = piece.row + dr, piece.col + dc
        # Check blocking piece (elephant eye)
        block_row, block_col = piece.row + dr // 2, piece.col + dc // 2
        if 0 <= new_row <= 9 and 0 <= new_col <= 8:
            if board.get_piece_at(block_row, block_col) is None:
                moves.append((new_row, new_col))
    return moves


def _get_horse_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Horse moves in an L-shape if not blocked"""
    moves = []
    # (row_first, col_second) - horse moves one step orthogonally then diagonally
    patterns = [
        ((-1, 0), (-2, -1)), ((-1, 0), (-2, 1)),  # Up then diagonal
        ((1, 0), (2, -1)), ((1, 0), (2, 1)),       # Down then diagonal
        ((0, -1), (-1, -2)), ((0, -1), (1, -2)),   # Left then diagonal
        ((0, 1), (-1, 2)), ((0, 1), (1, 2))        # Right then diagonal
    ]
    for (br, bc), (mr, mc) in patterns:
        block_row, block_col = piece.row + br, piece.col + bc
        new_row, new_col = piece.row + mr, piece.col + mc
        if 0 <= new_row <= 9 and 0 <= new_col <= 8:
            if board.get_piece_at(block_row, block_col) is None:
                moves.append((new_row, new_col))
    return moves


def _get_chariot_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Chariot moves any number of squares orthogonally"""
    moves = []
    for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        for i in range(1, 10):
            new_row, new_col = piece.row + dr * i, piece.col + dc * i
            if not (0 <= new_row <= 9 and 0 <= new_col <= 8):
                break
            target = board.get_piece_at(new_row, new_col)
            if target is None:
                moves.append((new_row, new_col))
            else:
                if target.color != piece.color:
                    moves.append((new_row, new_col))
                break
    return moves


def _get_cannon_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Cannon moves orthogonally, jumps over one piece to capture"""
    moves = []
    for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        jumped = False
        for i in range(1, 10):
            new_row, new_col = piece.row + dr * i, piece.col + dc * i
            if not (0 <= new_row <= 9 and 0 <= new_col <= 8):
                break
            target = board.get_piece_at(new_row, new_col)
            if not jumped:
                if target is None:
                    moves.append((new_row, new_col))
                else:
                    jumped = True
            else:
                if target is not None:
                    if target.color != piece.color:
                        moves.append((new_row, new_col))
                    break
    return moves


def _get_soldier_moves(board: Board, piece: Piece) -> List[Tuple[int, int]]:
    """Soldier moves forward, sideways after crossing river (opponent's side only)"""
    moves = []
    forward = 1 if piece.color == Color.RED else -1

    # Always can move forward
    new_row = piece.row + forward
    if 0 <= new_row <= 9:
        moves.append((new_row, piece.col))

    # Can move sideways ONLY if on opponent's side (crossed river)
    # This applies to all pieces using soldier ability, not just soldiers
    crossed = (piece.color == Color.RED and piece.row >= 5) or \
              (piece.color == Color.BLACK and piece.row <= 4)

    if crossed:
        for dc in [-1, 1]:
            new_col = piece.col + dc
            if 0 <= new_col <= 8:
                moves.append((piece.row, new_col))

    return moves


def _would_be_in_check(game: Game, piece: Piece, move: Tuple[int, int]) -> bool:
    """Check if making this move would put own king in check"""
    # Create a temporary board state
    new_row, new_col = move
    old_row, old_col = piece.row, piece.col

    # Temporarily make the move
    target = game.board.get_piece_at(new_row, new_col)
    piece.row, piece.col = new_row, new_col
    if target:
        game.board.pieces.remove(target)

    # Check if king is in check
    in_check = is_in_check(game.board, piece.color)

    # Undo the move
    piece.row, piece.col = old_row, old_col
    if target:
        game.board.pieces.append(target)

    return in_check


def is_in_check(board: Board, color: Color) -> bool:
    """Check if the given color's king is in check"""
    # Find the king
    king = None
    for piece in board.pieces:
        if piece.piece_type == PieceType.GENERAL and piece.color == color:
            king = piece
            break

    if king is None:
        return True  # King captured, definitely in check

    # Check if any enemy piece can capture the king
    enemy_color = Color.BLACK if color == Color.RED else Color.RED
    for piece in board.pieces:
        if piece.color == enemy_color:
            all_types = {piece.piece_type} | piece.acquired_abilities
            for ptype in all_types:
                moves = _get_moves_for_type(board, piece, ptype)
                if (king.row, king.col) in moves:
                    return True

    # Check for flying general (generals facing each other)
    enemy_king = None
    for piece in board.pieces:
        if piece.piece_type == PieceType.GENERAL and piece.color == enemy_color:
            enemy_king = piece
            break

    if enemy_king and king.col == enemy_king.col:
        # Check if path is clear between kings
        min_row = min(king.row, enemy_king.row)
        max_row = max(king.row, enemy_king.row)
        path_clear = True
        for row in range(min_row + 1, max_row):
            if board.get_piece_at(row, king.col):
                path_clear = False
                break
        if path_clear:
            return True

    return False


def is_checkmate(game: Game, color: Color) -> bool:
    """Check if the given color is in checkmate"""
    if not is_in_check(game.board, color):
        return False

    # Check if any move can get out of check
    for piece in game.board.pieces:
        if piece.color == color:
            moves = get_valid_moves(game, piece)
            if moves:
                return False

    return True


def make_move(game: Game, from_pos: Tuple[int, int], to_pos: Tuple[int, int]) -> dict:
    """Make a move on the board"""
    from_row, from_col = from_pos
    to_row, to_col = to_pos

    piece = game.board.get_piece_at(from_row, from_col)
    if piece is None:
        return {"success": False, "error": "No piece at source position"}

    if piece.color != game.current_turn:
        return {"success": False, "error": "Not your turn"}

    valid_moves = get_valid_moves(game, piece)
    if to_pos not in valid_moves:
        return {"success": False, "error": "Invalid move"}

    # Check for capture
    target = game.board.get_piece_at(to_row, to_col)
    captured_type = None
    if target:
        captured_type = target.piece_type
        # Absorption: gain only target's DEFAULT type (not acquired abilities)
        # This prevents snowballing and keeps the game balanced
        if target.piece_type != piece.piece_type and target.piece_type not in piece.acquired_abilities:
            piece.acquired_abilities.add(target.piece_type)
        game.board.remove_piece(target)

    # Move the piece
    piece.row, piece.col = to_row, to_col

    # Record the move
    move_record = {
        "from": list(from_pos),
        "to": list(to_pos),
        "piece": piece.piece_type.value,
        "color": piece.color.value,
        "captured": captured_type.value if captured_type else None
    }
    game.move_history.append(move_record)

    # Switch turns
    game.current_turn = Color.BLACK if game.current_turn == Color.RED else Color.RED

    # Check for checkmate
    if is_checkmate(game, game.current_turn):
        game.state = GameState.RED_WIN if game.current_turn == Color.BLACK else GameState.BLACK_WIN

    return {
        "success": True,
        "move": move_record,
        "in_check": is_in_check(game.board, game.current_turn),
        "game_over": game.state in (GameState.RED_WIN, GameState.BLACK_WIN),
        "winner": game.state.value if game.state in (GameState.RED_WIN, GameState.BLACK_WIN) else None
    }
