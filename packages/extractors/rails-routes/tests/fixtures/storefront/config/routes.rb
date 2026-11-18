Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  root "storefront#index"

  concern :commentable do
    resources :comments, only: %i[index create]
  end

  concern :archivable do
    member do
      post :archive
      delete :archive, action: :unarchive
    end
  end

  resource :session, only: %i[new create destroy]
  resources :passwords, param: :token, only: %i[new create edit update]
  resource :account, controller: "profiles", except: :destroy do
    get :billing
  end

  resources :products, only: %i[index show], param: :sku do
    collection do
      get :search
      get "on-sale", to: "products#on_sale"
    end
    resources :reviews, shallow: true, concerns: :commentable
  end

  resources :orders, except: %i[edit destroy], concerns: :archivable do
    resources :line_items, path: "items", as: :items
    resource :shipment, only: :show
    get :receipt, on: :member
    patch :cancel, on: :member
  end

  resources :categories, path: "c", only: :show
  resources :news, only: %i[index show]

  get "pages/:slug", to: "pages#show", as: :page, constraints: { slug: /[a-z0-9-]+/ }
  get "help", to: "pages#show", defaults: { slug: "help" }
  get "/legacy/catalog", to: redirect("/products", status: 301)
  match "contact", to: "contact#create", via: %i[get post]
  match "webhooks/:provider", to: "webhooks#receive", via: :all, format: false

  scope "(:locale)", locale: /en|fr/ do
    resources :stores, only: :index
  end

  scope module: :marketing, path: "promo", as: :promo do
    resources :campaigns, only: %i[index show]
  end

  namespace :admin do
    root "dashboard#show"
    resources :products do
      resources :variants, except: :show
    end
    resources :orders, only: %i[index show update] do
      member do
        post :refund
      end
    end
    resources :users, shallow: true do
      resources :notes
    end
    resources :inventory, only: %i[index show]
    get "reports/sales", as: :sales_report
  end

  namespace :api, defaults: { format: :json } do
    namespace :v1 do
      resources :products, only: %i[index show]
      resources :orders, only: %i[index show create]
      resource :me, controller: "accounts", only: :show
    end
  end

  constraints subdomain: "partners" do
    scope module: :partners, as: :partners do
      resources :reports, only: :index
    end
  end

  controller :checkout do
    get "checkout" => :show, as: :checkout
    post "checkout/confirm" => :confirm
  end

  mount Sidekiq::Web => "/jobs"
  mount HealthCheck, at: "/healthz", as: :health

  draw :support

  direct :homepage do
    "https://example.com"
  end
end
