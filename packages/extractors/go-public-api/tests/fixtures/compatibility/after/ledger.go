// Package ledger records amounts in an append-only ledger.
package ledger

import (
	"errors"
	"fmt"

	"example.com/ledger/internal/codec"
)

// Version is the library version.
const Version = "2.0.0"

// MaxEntries bounds a ledger.
const MaxEntries = 5000

// ErrNotFound reports a missing entry.
var ErrNotFound = errors.New("ledger: entry not found")

// Amount is a quantity in minor units.
type Amount int64

// Currency is an ISO 4217 code.
type Currency string

// Entry is one ledger line.
type Entry struct {
	ID     string
	Amount Amount
	Memo   string
	Tags   []string
}

// Store persists entries.
type Store interface {
	Put(entry Entry) error
	Get(id string) (Entry, error)
	Delete(id string) error
}

// ReadOnlyStore serves a fixed set of entries.
type ReadOnlyStore struct{ Entries map[string]Entry }

func (s ReadOnlyStore) Put(Entry) error { return errors.New("ledger: read-only") }

func (s ReadOnlyStore) Get(id string) (Entry, error) {
	if entry, ok := s.Entries[id]; ok {
		return entry, nil
	}
	return Entry{}, ErrNotFound
}

// Option configures a ledger.
type Option func(*Ledger)

// WithLimit bounds the ledger at limit entries.
func WithLimit(limit int) Option { return func(l *Ledger) { l.limit = limit } }

// Ledger appends entries to a store.
type Ledger struct {
	store   Store
	entries []Entry
	limit   int
}

// New returns a ledger over store.
func New(store Store, options ...Option) *Ledger {
	ledger := &Ledger{store: store, limit: MaxEntries}
	for _, option := range options {
		option(ledger)
	}
	return ledger
}

// Append records an entry.
func (l *Ledger) Append(entry Entry) error {
	if len(l.entries) >= l.limit {
		return errors.New("ledger: full")
	}
	l.entries = append(l.entries, entry)
	return l.store.Put(entry)
}

// Len is the number of entries.
func (l *Ledger) Len() int { return len(l.entries) }

// Format renders an amount.
func Format(amount Amount, currency Currency) string {
	return fmt.Sprintf("%d %s %x", amount, currency, codec.Encode(string(currency)))
}
