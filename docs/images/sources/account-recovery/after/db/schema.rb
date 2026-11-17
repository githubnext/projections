# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.

ActiveRecord::Schema[7.1].define(version: 2024_05_20_093045) do
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

  create_table "license_purchases", force: :cascade do |t|
    t.bigint "license_id", null: false
    t.bigint "user_id", null: false
    t.string "store", null: false
    t.string "order_reference", null: false
    t.decimal "amount", precision: 10, scale: 2, null: false
    t.string "currency", limit: 3, default: "USD", null: false
    t.datetime "purchased_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["license_id"], name: "index_license_purchases_on_license_id"
    t.index ["store", "order_reference"], name: "index_license_purchases_on_store_and_order_reference", unique: true
    t.index ["user_id"], name: "index_license_purchases_on_user_id"
  end

  create_table "licenses", force: :cascade do |t|
    t.string "key", limit: 64, null: false
    t.string "email"
    t.bigint "user_id"
    t.string "edition", default: "personal", null: false
    t.integer "seats", default: 1, null: false
    t.datetime "expires_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_licenses_on_key", unique: true
    t.index ["user_id"], name: "index_licenses_on_user_id"
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

  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest", null: false
    t.string "recovery_token"
    t.datetime "recovery_sent_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["recovery_token"], name: "index_users_on_recovery_token", unique: true
  end

  add_foreign_key "activations", "licenses", on_delete: :cascade
  add_foreign_key "license_purchases", "licenses"
  add_foreign_key "license_purchases", "users"
  add_foreign_key "licenses", "users"
end
