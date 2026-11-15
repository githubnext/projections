from django.db import models
from django.db.models import Q


class Author(models.Model):
    name = models.CharField(max_length=120)
    born = models.DateField(null=True, blank=True)


class Book(models.Model):
    title = models.CharField(max_length=200)
    isbn = models.CharField(max_length=13, unique=True)
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="books")
    published = models.DateField()
    pages = models.IntegerField()

    class Meta:
        constraints = [models.CheckConstraint(check=Q(pages__gt=0), name="book_pages_positive")]


class Member(models.Model):
    email = models.EmailField(unique=True)
    joined = models.DateTimeField(auto_now_add=True)


class Loan(models.Model):
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="loans")
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="loans")
    borrowed_at = models.DateTimeField()
    due = models.DateField()
    returned_at = models.DateTimeField(null=True, blank=True)
