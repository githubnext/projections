# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.

ActiveRecord::Schema[7.1].define(version: 2024_04_02_151200) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "plpgsql"

  create_table "activations", force: :cascade do |t|
    t.bigint "license_id", null: false
    t.string "machine_fingerprint", null: false
    t.string "app_version", limit: 32
    t.datetime "last_seen_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["license_id", "machine_fingerprint"], name: "index_activations_on_license_id_and_machine_fingerprint", unique: true
  end

  create_table "licenses", force: :cascade do |t|
    t.string "key", limit: 64, null: false
    t.string "email", null: false
    t.string "edition", default: "personal", null: false
    t.integer "seats", default: 1, null: false
    t.datetime "expires_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_licenses_on_email"
    t.index ["key"], name: "index_licenses_on_key", unique: true
  end

  create_table "releases", force: :cascade do |t|
    t.string "version", limit: 32, null: false
    t.string "channel", default: "stable", null: false
    t.text "notes"
    t.datetime "published_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["channel", "version"], name: "index_releases_on_channel_and_version", unique: true
  end

  add_foreign_key "activations", "licenses", on_delete: :cascade
end
