# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:setup` should be used
# instead of loading this file.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.1].define(version: 2024_09_18_101500) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "citext"
  enable_extension "pgcrypto"
  enable_extension "plpgsql"

  # Custom types defined in this database.
  # Note that some types may not work with other database engines. Be careful if changing database.
  create_enum "order_status", ["pending", "paid", "shipped", "cancelled"]

  create_table "active_storage_attachments", force: :cascade do |t|
    t.string "name", null: false
    t.string "record_type", null: false
    t.bigint "record_id", null: false
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.string "key", null: false
    t.string "filename", null: false
    t.string "content_type"
    t.text "metadata"
    t.string "service_name", null: false
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "accounts", id: :uuid, default: -> { "gen_random_uuid()" }, comment: "A customer or a business", force: :cascade do |t|
    t.citext "email", null: false
    t.string "name", limit: 120, null: false
    t.string "roles", default: [], null: false, array: true
    t.jsonb "preferences", default: {}, null: false
    t.boolean "admin", default: false, null: false
    t.datetime "confirmed_at", precision: nil
    t.virtual "display_name", type: :string, as: "COALESCE(name, (email)::text)", stored: true
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((email)::text)", name: "index_accounts_on_lower_email", unique: true
    t.index ["preferences"], name: "index_accounts_on_preferences", using: :gin
    t.check_constraint "char_length(name::text) > 0", name: "accounts_name_present"
  end

  create_table "line_items", force: :cascade do |t|
    t.bigint "order_id", null: false
    t.bigint "product_id", null: false
    t.integer "quantity", default: 1, null: false
    t.decimal "unit_price", precision: 10, scale: 2, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["order_id", "product_id"], name: "index_line_items_on_order_id_and_product_id", unique: true
    t.index ["product_id"], name: "index_line_items_on_product_id"
    t.check_constraint "quantity > 0", name: "line_items_quantity_positive"
  end

  create_table "orders", force: :cascade do |t|
    t.uuid "account_id", null: false
    t.enum "status", default: "pending", null: false, enum_type: "order_status"
    t.decimal "total", precision: 12, scale: 2, default: "0.0", null: false
    t.string "currency", limit: 3, default: "USD", null: false
    t.datetime "placed_at", default: -> { "CURRENT_TIMESTAMP" }, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["account_id", "placed_at"], name: "index_orders_on_account_id_and_placed_at", order: { placed_at: :desc }
    t.index ["status"], name: "index_orders_on_status_open", where: "((status)::text <> 'cancelled'::text)"
  end

  create_table "product_tags", primary_key: ["product_id", "tag"], force: :cascade do |t|
    t.bigint "product_id", null: false
    t.string "tag", null: false
  end

  create_table "products", force: :cascade do |t|
    t.string "sku", limit: 32, null: false
    t.string "title", null: false
    t.text "description"
    t.decimal "price", precision: 10, scale: 2, null: false
    t.integer "stock", default: 0, null: false
    t.datetime "discontinued_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["sku"], name: "index_products_on_sku", unique: true
  end

  create_table "schema_notes", id: false, force: :cascade do |t|
    t.string "note"
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "line_items", "orders", on_delete: :cascade
  add_foreign_key "line_items", "products"
  add_foreign_key "orders", "accounts", on_delete: :restrict
  add_foreign_key "product_tags", "products", on_delete: :cascade
end
