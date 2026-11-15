package memory

import (
	"context"
	"io"
	"strings"

	"example.org/packages/internal/codec"
	"example.org/packages/store"
)

type Memory struct{ codec codec.Encoder }

func (m *Memory) Get(ctx context.Context, key store.Key) (store.Record, error) { return store.Record{}, nil }
func (m *Memory) Put(ctx context.Context, record store.Record) error      { return nil }
func (m *Memory) Close() error                                            { return nil }
func (m *Memory) Read(p []byte) (int, error)                              { return 0, io.EOF }

type Records []store.Record

func (r Records) Items() []store.Record { return r }

type Builder = strings.Builder

type ReadCloser = io.ReadCloser

type unexportedImpl struct{}

func (unexportedImpl) hidden() {}
