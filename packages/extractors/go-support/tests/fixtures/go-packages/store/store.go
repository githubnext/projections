// Package store declares storage interfaces other packages implement.
package store

import (
	"context"
	"io"
)

type Key string

type Record struct {
	Key   Key
	Value []byte
}

type Store interface {
	Get(ctx context.Context, key Key) (Record, error)
	Put(ctx context.Context, record Record) error
}

type Closer interface {
	io.Closer
}

type Snapshot[T any] interface {
	Items() []T
}

type unexported interface{ hidden() }
