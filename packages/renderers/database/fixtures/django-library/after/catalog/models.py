from django.db import models


class Author(models.Model):
    name = models.CharField(max_length=200)
    born = models.DateField(null=True, blank=True)


class Publisher(models.Model):
    name = models.CharField(max_length=160, unique=True)
    country = models.CharField(max_length=2)


class Book(models.Model):
    title = models.CharField(max_length=200)
    isbn = models.CharField(max_length=13, unique=True)
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="books")
    publisher = models.ForeignKey(Publisher, on_delete=models.SET_NULL, null=True, related_name="books")
    published = models.DateField()
    pages = models.PositiveIntegerField()


class Member(models.Model):
    email = models.EmailField(unique=True)
    joined = models.DateTimeField(auto_now_add=True)


class Loan(models.Model):
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="loans")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="loans")
    borrowed_at = models.DateTimeField()
    due = models.DateField()
    returned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["member", "due"], name="loan_member_due")]
