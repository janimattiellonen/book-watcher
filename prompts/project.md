# Project

A tool (website + scripts) for notifying me when new books from selected authors are available as e-books on selected 
websites within a selected price range.

I intend to run this system only locally on my computer. I will at times visit the website at a defined localhost+port url. I'll have a scheduled job running in the background, doing the heavy work.

Create the project in this same directory.

## Technology

- React Router 8 (website)
- Typescript (website and scripts)
- npm
- port 3192
- prettier
- lint
- typecheck
- Docker
    - docker-compose.yml
- postgresql (Dockerized)
    - postgres:17
    - custom port: 5499
- scheduler
    - see referencve project `/Users/janimattiellonen/Documents/Development/Frisbeegolf/player-tracker`    

## Book sources
- https://www.adlibris.com
- https://www.bokus.com/

Both of these sites have a search system that passes query params in the url. This can be used for making requests to both sites and then parse the contents for the information that we want.

For example the url `https://www.bokus.com/search?q=viveca+sten&facets=format%3AEBOOK%2ClanguageCodes%3Aswe` provides the following interesting data: name of author, book format and language.

Similar url for adlibris: `https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=heikki%20hietala` provides: name of author, book format and language.


## Listeners

I want to create several listeners, where each listener is configured with search params instructing it to search for a spefic author's new books that meet set requirements:
- book format
- language
- price range

I often read several books from same authors and often the language is tied to the author: I always read one author's books in the same language.

## Database

The listeners must somehow know whether a found book is new or not. Initially the listeners will find a lot of books for each author as the database has no records. The accompanied website allows me to mark books as read, accepted or rejected. If accepted, then it's a book that I want to read and it will stay on a waiting list, until I mark it as read or rejected (I might change my mind about a book).

### Schema 

We need a database schema for this project.

### Migration

Use same migration tools as in project `/Users/janimattiellonen/Documents/Fraktio/Projektit/talokatsastus/talokatsastus-api`


## Website

The website allows me to see new suggestions and mark them.


## Initial seed

At first, there are no records in the database. At this point it's useless to notify me about new books. I plan to NOT manually add all books that I have read from a certain author. Instead, when I add a new author to the system, I create a new listener for that author and then "seed" the database with his/her books. I then mark the found books as I choose (read, accepted, rejected).


## Notifications

When an initial seed has been built: that is, when all books for each listener has been recorded, any new book that is found by the listeners, result in a notification been compiled and sent to me by e-mail. This way, I don't necessarilly have to visit the website.

## Scheduler

A configured scheduler will be running with specified intervals.

## Specs

Before implementing, create a spec using skill "agent-skills:spec". Store the spec in "/specs".
When the specs have been accepted, we'll create a plan including tasks for determining how to implement this.







