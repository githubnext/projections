SECRET_KEY = "library-fixture-not-a-production-secret"
INSTALLED_APPS = ["catalog"]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
