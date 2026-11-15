use cel::parser::pratt_parser::{Lexer, TokenKind};

/// A token's kind, as far as context doesn't decide it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Ident,
    Keyword,
    Number,
    Str,
    Comment,
    Dot,
    Comma,
    LeftParen,
    RightParen,
    LeftBracket,
    RightBracket,
    LeftBrace,
    RightBrace,
    Operator,
    Error,
}

/// A token: its kind and its characters' offsets in the expression.
#[derive(Debug, Clone, Copy)]
pub struct Lexeme {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
}

pub(super) fn kind(token: TokenKind) -> Kind {
    use TokenKind::*;
    match token {
        TokIdent => Kind::Ident,
        TokNull | TokFalse | TokTrue | TokIn | TokReservedWord => Kind::Keyword,
        TokInt | TokUint | TokFloat => Kind::Number,
        TokString | TokBytes => Kind::Str,
        TokComment => Kind::Comment,
        TokDot => Kind::Dot,
        TokComma => Kind::Comma,
        TokLeftParen => Kind::LeftParen,
        TokRightParen => Kind::RightParen,
        TokLeftBracket => Kind::LeftBracket,
        TokRightBracket => Kind::RightBracket,
        TokLeftBrace => Kind::LeftBrace,
        TokRightBrace => Kind::RightBrace,
        TokError | TokEnd | TokWhitespace => Kind::Error,
        _ => Kind::Operator,
    }
}

/// The expression's tokens, without whitespace. Lexing continues after an
/// error, so an expression being typed still has tokens.
pub fn lex(source: &str) -> Vec<Lexeme> {
    let starts: Vec<usize> = source.char_indices().map(|(byte, _)| byte).collect();
    let char_at = |byte: usize| starts.partition_point(|start| *start < byte);
    let mut lexemes = Vec::new();
    let mut base = 0;
    while base < source.len() {
        let mut lexer = Lexer::new(&source[base..]);
        let mut restart = None;
        loop {
            let token = lexer.lex();
            let (start, end) = (base + token.start, base + token.end);
            match token.kind {
                TokenKind::TokEnd => break,
                TokenKind::TokWhitespace => {}
                TokenKind::TokError => {
                    let rest = &source[start.min(source.len())..];
                    let first = rest.chars().next().map_or(1, char::len_utf8);
                    // An unterminated string is a string to the end.
                    let quoted = rest.trim_start_matches(['r', 'R', 'b', 'B']).starts_with(['\'', '"']);
                    let end = if quoted {
                        source.len()
                    } else {
                        end.max(start + first).min(source.len())
                    };
                    lexemes.push(Lexeme {
                        kind: if quoted { Kind::Str } else { Kind::Error },
                        start: char_at(start),
                        end: char_at(end),
                    });
                    restart = Some(end);
                    break;
                }
                other => lexemes.push(Lexeme {
                    kind: kind(other),
                    start: char_at(start),
                    end: char_at(end),
                }),
            }
        }
        match restart {
            Some(next) if next > base => base = next,
            _ => break,
        }
    }
    lexemes
}
