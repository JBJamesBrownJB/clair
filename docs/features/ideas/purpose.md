what is the purpose of clair?

- pairing on a feature, same branch? I think this is a dud and competes against other live coding stuff
- working in the same repo but on different branches: more likely, its like its a way to keep in loose touch with all the ther agents who are busy on their own branches, maybe worktress but ultimatley, you are developing alone. However, you can send info to others in the codebase if you want to.
- - Keep in loose touch with all agents and people in the codebase, clair will smartly bring things to your attention if it spots you are making decisison that need context from the other agents. (*"smartly"* is defined concretely in [progressive-disclosure.md](progressive-disclosure.md): escalate the grain of disclosure as relevance rises.)
- - See live snippets and activity of others in the codebase on demand and smartly delivered to you
- - Push messages along with context from your session to an agent or user who is in the codebase directly
- - Have clair maintain global artifacts that benefit from global activity awareness across the repo
- - Clair will smartly let you know if you and another agent/human are in potential merge regions in the codebase, will direct you to sync up!

So, I think we should pivot to clair being an 'Ambient awareness' tool, keeping you roughly in touch with others in the repo?

Maybe we remove all the pair stuff and instead just enroll everyone.

**Clare: Give you and our agents full ambient awareness of all other activity in the repo**

- - probably, the implimentation should always keep these things most up to date
- - - Where everyone is in the codebase
- - - Large architectural changes / decisions
- - - Incidents / P1 bugs being fixed or acted on
- - - Key surprises or findings by others


- Future feature: global awareness

In this new world, the signals being sent from each 'client' need to be flares to 'catch' the right scenarios.
Maybe things like, Rajiv is working over in this part of the code, implimenting this feature....