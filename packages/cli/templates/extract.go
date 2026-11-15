// Extractor for the "{{id}}" projection.
//
// Projections runs this program with a request on stdin and reads one
// extraction from stdout: the entities and relationships that matter in this
// codebase, as data. `projections help authoring` explains the whole loop.
//
// The starter describes each top-level directory and how many files it holds.
// Replace it with the facts this projection is about.
//
// Rules: read the examined revision only through request.Repository.Root, never
// the network or the clock, and sort what you emit, so the same revision always
// gives the same extraction. Give items IDs that stay stable when unrelated
// things change ("route:GET /orders", not a list position).
//
// This projection's project (the directory holding its definition) is
// request.Repository.Project in that root, empty for the repository's root.
// The definition's paths and inputs are relative to it; so are evidence paths.
package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type request struct {
	Repository struct {
		Root    string `json:"root"`
		Project string `json:"project"`
	} `json:"repository"`
}

type evidence struct {
	Kind   string `json:"kind"`
	Source string `json:"source"`
}

type entity struct {
	ID       string         `json:"id"`
	Kind     string         `json:"kind"`
	Label    string         `json:"label"`
	Data     map[string]any `json:"data,omitempty"`
	Evidence []evidence     `json:"evidence,omitempty"`
}

type relationship struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	From string `json:"from"`
	To   string `json:"to"`
}

type extraction struct {
	ProtocolVersion int            `json:"protocolVersion"`
	Schema          string         `json:"schema"`
	Entities        []entity       `json:"entities"`
	Relationships   []relationship `json:"relationships"`
}

func fail(err error) {
	os.Stderr.WriteString(err.Error() + "\n")
	os.Exit(1)
}

func main() {
	var req request
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		fail(err)
	}
	root := filepath.Join(req.Repository.Root, filepath.FromSlash(req.Repository.Project))
	entries, err := os.ReadDir(root)
	if err != nil {
		fail(err)
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	result := extraction{ProtocolVersion: 0, Schema: "graph/v0", Entities: []entity{}, Relationships: []relationship{}}
	for _, name := range names {
		files := 0
		err := filepath.WalkDir(filepath.Join(root, name), func(_ string, entry fs.DirEntry, err error) error {
			if err == nil && entry.Type().IsRegular() {
				files++
			}
			return err
		})
		if err != nil {
			fail(err)
		}
		result.Entities = append(result.Entities, entity{
			ID:       "directory:" + name,
			Kind:     "directory",
			Label:    name,
			Data:     map[string]any{"files": files},
			Evidence: []evidence{{Kind: "file", Source: name}},
		})
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fail(err)
	}
}
