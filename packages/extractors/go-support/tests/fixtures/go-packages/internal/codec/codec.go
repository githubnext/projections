package codec

import "example.org/packages/store"

type Encoder interface {
	Encode(store.Record) ([]byte, error)
}

type JSON struct{}

func (JSON) Encode(store.Record) ([]byte, error) { return nil, nil }
