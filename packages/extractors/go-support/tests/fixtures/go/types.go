package interfaces

type Reader interface{ Read() string }
type Value struct{}

func (Value) Read() string { return "value" }

type Pointer struct{}

func (*Pointer) Read() string { return "pointer" }

type Missing struct{}
type Embedded interface {
	Reader
	Close() error
}
type Full struct{ Value }

func (Full) Close() error { return nil }

type Alias = Value
type Numeric interface{ ~int | ~int64 }
type Count int
type Box[T any] struct{ Value T }

func (Box[T]) Read() string { return "generic" }

type Generic[T any] interface{ Put(T) }
type StringWriter = Generic[string]
type StringStore struct{}

func (StringStore) Put(string) {}
