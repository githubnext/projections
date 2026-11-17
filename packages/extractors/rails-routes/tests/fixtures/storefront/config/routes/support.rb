namespace :support do
  resources :tickets, only: %i[index show create] do
    resources :messages, only: :create
  end
end
