Rails.application.routes.draw do
  scope ":account_id", as: "account", constraints: { account_id: /\d+/ } do
    resources :invoices, :payments
    resources :ledgers, shallow: true do
      resources :entries do
        resources :attachments, only: %i[index create destroy]
        get :preview, on: :member
      end
      get :balance
    end
  end

  resources :photos, as: "images", controller: "pictures" do
    root to: "pictures#gallery"
    get :search, on: :collection
  end
  resources :tags, module: "taxonomy", only: :index
  resource :settings do
    resources :keys, only: %i[index create]
    get :export
  end

  namespace :admin, path: "backoffice", as: "bo" do
    resources :audits, only: %i[index show]
    delete "logout", controller: "/sessions", action: :destroy
    namespace :reports do
      get "daily(/:date)", to: "daily#show", as: :daily
    end
  end

  namespace :internal, shallow_path: "i", shallow_prefix: "i" do
    resources :jobs, shallow: true do
      resources :runs
    end
  end

  scope path: "/v2", as: "v2", module: "v2" do
    resources :webhooks, only: %i[index create]
  end

  scope controller: :status do
    get :ping
    get "version", action: :version
  end

  with_options only: %i[index show], controller: "feeds" do
    resources :public_feeds
    get "trending", action: :trending
  end

  with_options to: "accounts#show" do |r|
    r.get "/@:username", as: :short_account
  end

  namespace :webhooks do
    post "stripe"
    get :health
  end

  constraints ApiVersion.new(2) do
    scope module: :v2 do
      resources :reports, only: :index
    end
  end

  get "reports/monthly"
  get "exports/:id.csv", to: "exports#show", format: false
  get "feeds/:slug", to: "feeds#show", format: true
  get "search", controller: :search, action: :index
  match "graphql", to: "graphql#execute", via: [:post, :get]
  post "events" => "events#create", as: nil
end
