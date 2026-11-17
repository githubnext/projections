# This file is auto-generated from the current state of the database.

ActiveRecord::Schema.define(version: 2020_03_11_084512) do

  create_table "categories", options: "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4", force: :cascade do |t|
    t.string "name", null: false
    t.integer "position", limit: 2, default: 0, unsigned: true
    t.datetime "created_at", precision: 6, null: false
    t.datetime "updated_at", precision: 6, null: false
  end

  create_table "people", id: :integer, options: "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4", force: :cascade do |t|
    t.string "name"
    t.bigint "category_id"
    t.text "bio", size: :medium
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["category_id"], name: "index_people_on_category_id"
    t.index ["name"], name: "index_people_on_name", length: 20, type: :fulltext
  end

  add_foreign_key "people", "categories"
end
