Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  root "dashboards#show"
  get "download", to: "downloads#latest"

  resource :session, only: %i[new create destroy]
  resource :registration, only: %i[new create]
  resource :account, only: %i[show update] do
    resources :licenses, only: %i[index show], controller: "account/licenses"
    resources :purchases, only: :index, controller: "account/purchases"
  end
  resource :recovery, only: %i[new create edit update], param: :token

  resources :releases, only: %i[index show], param: :version

  namespace :api do
    namespace :v1 do
      resources :licenses, only: :show, param: :key do
        resources :activations, only: %i[create destroy]
        post :claim, on: :member
      end
      get "releases/latest", to: "releases#latest"
    end
  end

  namespace :webhooks do
    post "app-store", to: "app_store#create"
    post "paddle", to: "paddle#create"
  end

  namespace :admin do
    resources :licenses, except: :destroy
    resources :purchases, only: %i[index show]
    resources :releases
    resources :users, only: %i[index show]
  end
end
