package api

import (
	"example.org/packages/memory"
	"example.org/packages/store"
)

type Service struct{ store.Store }

type Wrapped memory.Memory

type Encoders interface {
	store.Closer
	Get() memory.Records
}
